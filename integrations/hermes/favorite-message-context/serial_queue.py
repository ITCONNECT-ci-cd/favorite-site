"""Profile-scoped Discord FIFO, before Hermes' interrupt/merge paths.

Only configured channels use this adapter. The built-in Discord registration
supplies all transport, authorization and configuration metadata unchanged.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
from collections import deque
from contextlib import suppress
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
_URL = re.compile(r"https?://[^\s<>]+", re.IGNORECASE)


class QueueStore:
    """Private original-event snapshots, committed before acknowledging receipt."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)

    def save(self, event: Any) -> None:
        payload = {
            "text": event.text,
            "source": event.source.to_dict(),
            "message_id": event.message_id,
            "timestamp": event.timestamp.isoformat(),
            "channel_prompt": event.channel_prompt,
        }
        fd, name = tempfile.mkstemp(dir=self.directory, prefix=".pending-")
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(payload, stream, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.directory / f"{event.message_id}.json")
            self._sync()
        finally:
            with suppress(FileNotFoundError):
                os.unlink(name)

    def restore(self) -> list[Any]:
        from gateway.platforms.base import MessageEvent
        from gateway.session import SessionSource

        events = []
        for path in sorted(self.directory.glob("*.json"), key=lambda p: int(p.stem)):
            data = json.loads(path.read_text())
            source = SessionSource.from_dict(data["source"])
            # Re-evaluate current user authorization; do not persist role grants.
            source.role_authorized = False
            events.append(MessageEvent(
                text=data["text"], source=source,
                message_id=data["message_id"],
                timestamp=datetime.fromisoformat(data["timestamp"]),
                channel_prompt=data["channel_prompt"],
            ))
        return events

    def finish(self, message_id: str) -> None:
        (self.directory / f"{message_id}.json").unlink(missing_ok=True)
        self._sync()

    def _sync(self) -> None:
        fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


class FavoriteQueueMixin:
    """Keep original events separate until their entire turn has finished."""

    def _init_favorite_queue(self, channels: frozenset[str], capacity: int, store: QueueStore) -> None:
        self._favorite_channels = channels
        self._favorite_capacity = capacity
        self._favorite_events: deque[Any] = deque()
        self._favorite_ids: set[str] = set()
        self._favorite_worker: asyncio.Task | None = None
        self._favorite_notices: set[asyncio.Task] = set()
        self._favorite_acks: dict[str, asyncio.Task] = {}
        self._favorite_outcomes: dict[str, Any] = {}
        self._favorite_stopping = False
        self._favorite_ready = False
        self._favorite_store = store
        for event in store.restore():
            if self._is_favorite_event(event):
                self._favorite_events.append(event)
                self._favorite_ids.add(event.message_id)

    def _is_favorite_event(self, event: Any) -> bool:
        return (
            str(event.source.chat_id) in self._favorite_channels
            and not getattr(event, "internal", False)
            and not getattr(event.source, "is_bot", False)
            and not getattr(getattr(getattr(event, "raw_message", None), "author", None), "bot", False)
        )

    def _enqueue_text_event(self, event: Any) -> None:
        # Discord batches *before* handle_message. Bypass it at this boundary
        # as well; changing only busy_input_mode leaves the first merge intact.
        if not self._accept_favorite(event):
            super()._enqueue_text_event(event)

    def _track_notice(self, coroutine: Any) -> asyncio.Task:
        task = asyncio.create_task(coroutine)
        self._favorite_notices.add(task)
        task.add_done_callback(self._favorite_notices.discard)
        task.add_done_callback(self._favorite_notice_done)
        return task

    @staticmethod
    def _favorite_notice_done(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Favorite receipt notification failed")

    async def connect(self, **kwargs: Any) -> bool:
        connected = await super().connect(**kwargs)
        if connected:
            self._favorite_stopping = False
            self._favorite_ready = True
            self._start_favorite_worker()
            logger.info("Favorite FIFO ready: channels=%d pending=%d", len(self._favorite_channels), len(self._favorite_events))
        return connected

    def _start_favorite_worker(self) -> None:
        if self._favorite_ready and self._favorite_events and (
            self._favorite_worker is None or self._favorite_worker.done()
        ):
            self._favorite_worker = asyncio.create_task(self._drain_favorite())

    async def handle_message(self, event: Any) -> None:
        if not self._accept_favorite(event):
            await super().handle_message(event)

    def _accept_favorite(self, event: Any) -> bool:
        from gateway.platforms.base import MessageType

        if not self._is_favorite_event(event) or event.get_command():
            return False
        if event.message_type != MessageType.TEXT:
            # The ingest contract ignores attachments.
            return True
        if not re.fullmatch(r"[0-9]{17,20}", str(event.message_id or "")):
            return True
        if event.message_id in self._favorite_ids:
            return True
        if self._favorite_stopping or len(self._favorite_events) >= self._favorite_capacity:
            self._track_notice(self._favorite_notice(event, "대기열에 접수하지 못했습니다. 잠시 후 이 메시지를 다시 보내 주세요."))
            return True

        try:
            self._favorite_store.save(event)
        except Exception:
            logger.warning("Favorite durable queue write failed")
            self._track_notice(self._favorite_notice(event, "접수 기록을 저장하지 못했습니다. 잠시 후 다시 보내 주세요."))
            return True

        # No await before ownership is recorded: bursts during agent setup
        # cannot overwrite a slot or start two consumers.
        self._favorite_events.append(event)
        self._favorite_ids.add(event.message_id)
        if _URL.search(event.text[:4000]):
            self._favorite_acks[event.message_id] = self._track_notice(self._favorite_ack(event))
        self._start_favorite_worker()
        return True

    async def _favorite_ack(self, event: Any) -> None:
        # A reaction denotes receipt only. The regular per-message reply is
        # the authority for saved/duplicate/failed results.
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self._add_reaction(event.raw_message, "⏳"), timeout=5)
        urls = dict.fromkeys(url.rstrip(".,!?;:)]}，。") for url in _URL.findall(event.text[:4000]))
        if len(urls) > 5:
            await self._favorite_notice(event, "한 메시지는 최대 5개 링크까지 처리합니다. 초과 링크는 새 메시지로 보내 주세요.")

    async def _favorite_notice(self, event: Any, text: str) -> None:
        try:
            await asyncio.wait_for(self._send_with_retry(
                chat_id=event.source.chat_id,
                content=text,
                reply_to=event.message_id,
            ), timeout=10)
        except Exception:
            logger.warning("Favorite queue notice delivery failed")

    async def _drain_favorite(self) -> None:
        try:
            while self._favorite_events and not self._favorite_stopping:
                event = self._favorite_events[0]
                try:
                    ack = self._favorite_acks.pop(event.message_id, None)
                    if ack is not None:
                        with suppress(Exception):
                            await asyncio.shield(ack)
                    await self._dispatch_favorite(event)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning("Favorite queued turn failed; keeping original receipt for restart")
                    await self._favorite_notice(event, "처리를 완료하지 못했습니다. 저장 결과를 확인한 뒤 다시 보내 주세요.")
                    # A host/adapter failure must not remove durable recovery data.
                    # Continue other accepted messages without a tight retry loop.
                else:
                    try:
                        self._favorite_store.finish(event.message_id)
                    except OSError:
                        logger.warning("Favorite completed receipt cleanup failed; replay remains idempotent")
                finally:
                    if not self._favorite_stopping:
                        with suppress(Exception):
                            await asyncio.wait_for(self._remove_reaction(event.raw_message, "⏳"), timeout=5)
                self._favorite_events.popleft()
                self._favorite_ids.discard(event.message_id)
        finally:
            self._favorite_worker = None

    async def _dispatch_favorite(self, event: Any) -> None:
        from gateway.session import build_session_key
        from gateway.platforms.base import ProcessingOutcome

        # A dedicated-profile runner holds early input in its own restore
        # buffer while starting. Do not hand accepted work to that second
        # queue and mistake its immediate return for a completed turn.
        runner = getattr(self._message_handler, "__self__", None)
        while getattr(runner, "_startup_restore_in_progress", False):
            await asyncio.sleep(0.05)
        key = build_session_key(
            event.source,
            group_sessions_per_user=self.config.extra.get("group_sessions_per_user", True),
            thread_sessions_per_user=self.config.extra.get("thread_sessions_per_user", False),
        )
        # Control commands or restored Hermes work may already own this session.
        # Wait for the full background task, including reply delivery/cleanup.
        await self._wait_favorite_session(key)
        self._favorite_outcomes.pop(event.message_id, None)
        await super().handle_message(event)
        await self._wait_favorite_session(key)
        outcome = self._favorite_outcomes.pop(event.message_id, None)
        if outcome not in (ProcessingOutcome.SUCCESS, ProcessingOutcome.CANCELLED):
            raise RuntimeError("Favorite turn did not finish successfully")

    async def on_processing_complete(self, event: Any, outcome: Any) -> None:
        if event.message_id in self._favorite_ids:
            self._favorite_outcomes[event.message_id] = outcome
        await super().on_processing_complete(event, outcome)

    async def _wait_favorite_session(self, key: str) -> None:
        while True:
            task = self._session_tasks.get(key)
            if task is None or task.done():
                return
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise
                # Explicit /stop can cancel the active turn. Still continue
                # with the other independently accepted messages.
            except Exception:
                logger.warning("Favorite session task failed")

    async def cancel_background_tasks(self) -> None:
        # The runner calls this BEFORE disconnect. Stop our consumer first,
        # otherwise a cancelled Hermes task can look like completed work.
        self._favorite_stopping = True
        self._favorite_ready = False
        worker = self._favorite_worker
        if worker is not None:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker
        if self._favorite_events:
            logger.warning("Favorite queue stopped with %d unfinished messages", len(self._favorite_events))
        for task in tuple(self._favorite_notices):
            task.cancel()
        if self._favorite_notices:
            await asyncio.gather(*self._favorite_notices, return_exceptions=True)
        self._favorite_acks.clear()
        await super().cancel_background_tasks()

    async def disconnect(self) -> None:
        await self.cancel_background_tasks()
        await super().disconnect()


def register_queue_platform(ctx: Any, channels: list[str], capacity: int) -> None:
    from plugins.platforms.discord.adapter import DiscordAdapter, register as register_discord

    class FavoriteDiscordAdapter(FavoriteQueueMixin, DiscordAdapter):
        def __init__(self, config: Any) -> None:
            from hermes_constants import get_hermes_home

            super().__init__(config)
            self._init_favorite_queue(
                frozenset(channels), capacity,
                QueueStore(get_hermes_home() / "state" / "favorite-queue"),
            )

    class RegistrationProxy:
        def register_platform(self, **kwargs: Any) -> Any:
            kwargs["adapter_factory"] = FavoriteDiscordAdapter
            return ctx.register_platform(**kwargs)

    register_discord(RegistrationProxy())
