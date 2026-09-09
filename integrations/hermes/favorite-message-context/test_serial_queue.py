"""Uses the installed Hermes base adapter; Discord and LLM calls are fakes."""
from __future__ import annotations

import asyncio
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import BasePlatformAdapter, MessageEvent, SendResult
from gateway.session import SessionSource

SPEC = importlib.util.spec_from_file_location("favorite_serial_queue", Path(__file__).with_name("serial_queue.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CHANNEL = "1536239187517247488"


def event(index: int, *, text: str | None = None, channel: str = CHANNEL) -> MessageEvent:
    return MessageEvent(
        text=text or f"https://example.com/{index}",
        source=SessionSource(platform=Platform.DISCORD, chat_id=channel, user_id="1536000000000000001", chat_type="group"),
        message_id=str(1536000000000000100 + index),
        raw_message=SimpleNamespace(author=SimpleNamespace(bot=False)),
        channel_prompt="Keep each message separate.",
    )


class FakeDiscord(BasePlatformAdapter):
    def __init__(self) -> None:
        super().__init__(PlatformConfig(typing_indicator=False), Platform.DISCORD)
        self.sent = []
        self.reactions = []
        self.batched = []

    async def connect(self, **kwargs):
        return True

    async def disconnect(self):
        await self.cancel_background_tasks()

    async def send(self, chat_id, content, **kwargs):
        self.sent.append((chat_id, content, kwargs))
        return SendResult(success=True, message_id="1536000000000000999")

    async def get_chat_info(self, chat_id):
        return {}

    async def _add_reaction(self, message, emoji):
        self.reactions.append(emoji)
        return True

    async def _remove_reaction(self, message, emoji):
        return True

    def _enqueue_text_event(self, incoming):
        self.batched.append(incoming)


class Adapter(MODULE.FavoriteQueueMixin, FakeDiscord):
    def __init__(self, directory: Path, capacity=32):
        super().__init__()
        self._init_favorite_queue(frozenset({CHANNEL}), capacity, MODULE.QueueStore(directory))


class SerialQueueTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"HERMES_HOME": str(self.home)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.adapters = []

    async def asyncTearDown(self):
        for adapter in self.adapters:
            await adapter.disconnect()

    async def adapter(self, handler, capacity=32):
        adapter = Adapter(self.home / "inbox", capacity)
        self.adapters.append(adapter)
        adapter.set_message_handler(handler)
        await adapter.connect()
        return adapter

    async def finish(self, adapter):
        worker = adapter._favorite_worker
        if worker:
            await asyncio.wait_for(asyncio.shield(worker), timeout=5)
        if adapter._favorite_notices:
            await asyncio.gather(*adapter._favorite_notices)

    async def test_ten_messages_before_agent_start_keep_ids_text_order_and_single_worker(self):
        seen = []
        async def handler(incoming):
            seen.append((incoming.message_id, incoming.text))
            return "저장 완료"
        adapter = await self.adapter(handler)
        messages = [event(i) for i in range(10)]
        for incoming in messages:
            await adapter.handle_message(incoming)
        self.assertEqual(len(adapter._favorite_events), 10)
        await self.finish(adapter)
        self.assertEqual(seen, [(e.message_id, e.text) for e in messages])
        self.assertFalse(list((self.home / "inbox").glob("*.json")))
        self.assertEqual(len(adapter.sent), 10)

    async def test_busy_burst_and_non_url_context_do_not_interrupt_or_merge(self):
        started, release = asyncio.Event(), asyncio.Event()
        seen = []
        async def handler(incoming):
            seen.append(incoming.message_id)
            if len(seen) == 1:
                started.set()
                await release.wait()
            return "저장 완료"
        adapter = await self.adapter(handler)
        async def forbidden_busy(*args):
            raise AssertionError("Favorite links reached the busy/merge path")
        adapter.set_busy_session_handler(forbidden_busy)
        await adapter.handle_message(event(0))
        await asyncio.wait_for(started.wait(), 2)
        for i in range(1, 10):
            adapter._enqueue_text_event(event(i))
        await adapter.handle_message(event(20, text="고마워"))
        await asyncio.gather(*adapter._favorite_notices)
        self.assertEqual(len(seen), 1)
        self.assertEqual(len(adapter._favorite_events), 11)
        release.set()
        await self.finish(adapter)
        self.assertEqual(seen, [event(i).message_id for i in range(10)] + [event(20).message_id])
        self.assertEqual(adapter.batched, [])

    async def test_duplicate_inflight_and_capacity_rejection_are_explicit(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def handler(incoming):
            started.set()
            await release.wait()
            return "저장 완료"
        adapter = await self.adapter(handler, capacity=2)
        await adapter.handle_message(event(0))
        await started.wait()
        await adapter.handle_message(event(0))
        await adapter.handle_message(event(1))
        await adapter.handle_message(event(2))
        await asyncio.gather(*adapter._favorite_notices)
        self.assertEqual(len(adapter._favorite_events), 2)
        self.assertEqual(len(list((self.home / "inbox").glob("*.json"))), 2)
        self.assertTrue(any("접수하지 못했습니다" in content for _, content, _ in adapter.sent))
        release.set()
        await self.finish(adapter)

    async def test_restart_restores_original_text_ids_and_only_unfinished_work(self):
        started, never = asyncio.Event(), asyncio.Event()
        first_seen = []
        async def interrupted(incoming):
            first_seen.append(incoming.message_id)
            if incoming.message_id == event(1).message_id:
                started.set()
                await never.wait()
            return "저장 완료"
        adapter = await self.adapter(interrupted)
        for i in range(4):
            await adapter.handle_message(event(i))
        await asyncio.wait_for(started.wait(), 3)
        await adapter.disconnect()
        restored = []
        async def resumed(incoming):
            restored.append((incoming.message_id, incoming.text, incoming.channel_prompt))
            return "저장 또는 기존 기록 확인 완료"
        replacement = await self.adapter(resumed)
        await self.finish(replacement)
        self.assertEqual(restored, [(event(i).message_id, event(i).text, event(i).channel_prompt) for i in range(1, 4)])
        self.assertFalse(list((self.home / "inbox").glob("*.json")))

    async def test_store_failure_is_not_acknowledged_or_dispatched(self):
        seen = []
        async def handler(incoming):
            seen.append(incoming)
        adapter = await self.adapter(handler)
        with patch.object(adapter._favorite_store, "save", side_effect=OSError("disk full")):
            await adapter.handle_message(event(0))
        await asyncio.gather(*adapter._favorite_notices)
        self.assertEqual(seen, [])
        self.assertEqual(adapter.reactions, [])
        self.assertTrue(any("접수 기록을 저장하지 못했습니다" in content for _, content, _ in adapter.sent))

    async def test_same_adapter_reconnect_does_not_await_cancelled_receipt_tasks(self):
        never = asyncio.Event()
        seen = []
        async def handler(incoming):
            seen.append(incoming.message_id)
            return "저장 완료"
        adapter = await self.adapter(handler)
        async def delayed_ack(*args):
            await never.wait()
        adapter._add_reaction = delayed_ack
        await adapter.handle_message(event(0))
        await adapter.handle_message(event(1))
        await adapter.disconnect()
        adapter._add_reaction = FakeDiscord._add_reaction.__get__(adapter)
        await adapter.connect(is_reconnect=True)
        await self.finish(adapter)
        self.assertEqual(seen, [event(0).message_id, event(1).message_id])

    async def test_failed_turn_preserves_receipt_and_next_message_still_runs(self):
        seen = []
        async def handler(incoming):
            seen.append(incoming.message_id)
            if incoming.message_id == event(0).message_id:
                raise RuntimeError("fake provider unavailable")
            return "저장 완료"
        adapter = await self.adapter(handler)
        await adapter.handle_message(event(0))
        await adapter.handle_message(event(1))
        await self.finish(adapter)
        self.assertEqual(seen, [event(0).message_id, event(1).message_id])
        self.assertEqual([p.stem for p in (self.home / "inbox").glob("*.json")], [event(0).message_id])

    async def test_gateway_restore_buffer_is_not_mistaken_for_a_finished_turn(self):
        received = []
        class Runner:
            _startup_restore_in_progress = True
            async def handle(self, incoming):
                received.append(incoming.message_id)
                return "저장 완료"
        runner = Runner()
        adapter = await self.adapter(runner.handle)
        await adapter.handle_message(event(0))
        # Yield enough for the worker to reach the readiness gate.
        await asyncio.sleep(0.01)
        self.assertEqual(received, [])
        self.assertTrue((self.home / "inbox" / f"{event(0).message_id}.json").exists())
        runner._startup_restore_in_progress = False
        await self.finish(adapter)
        self.assertEqual(received, [event(0).message_id])

    async def test_saved_receipts_are_private_and_do_not_retain_role_grants(self):
        incoming = event(0)
        incoming.source.role_authorized = True
        store = MODULE.QueueStore(self.home / "private-inbox")
        store.save(incoming)
        path = store.directory / f"{incoming.message_id}.json"
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(store.directory.stat().st_mode & 0o777, 0o700)
        self.assertFalse(store.restore()[0].source.role_authorized)

    async def test_over_five_links_warns_and_other_channels_keep_native_batching(self):
        seen = []
        async def handler(incoming):
            seen.append(incoming.text)
            return "처리 결과"
        adapter = await self.adapter(handler)
        text = "\n".join(f"https://example.com/{i}" for i in range(6))
        await adapter.handle_message(event(0, text=text))
        other = event(10, channel="1536000000000000002")
        adapter._enqueue_text_event(other)
        await self.finish(adapter)
        self.assertEqual(seen, [text])
        self.assertTrue(any("최대 5개" in content for _, content, _ in adapter.sent))
        self.assertEqual(adapter.batched, [other])

    async def test_registration_keeps_discord_auth_and_config_bridge(self):
        registered = []
        MODULE.register_queue_platform(SimpleNamespace(register_platform=lambda **kw: registered.append(kw)), [CHANNEL], 32)
        self.assertEqual(len(registered), 1)
        entry = registered[0]
        self.assertEqual(entry["allowed_users_env"], "DISCORD_ALLOWED_USERS")
        self.assertEqual(entry["allow_all_env"], "DISCORD_ALLOW_ALL_USERS")
        self.assertEqual(entry["required_env"], ["DISCORD_BOT_TOKEN"])
        self.assertTrue(callable(entry["apply_yaml_config_fn"]))
        self.assertTrue(issubclass(entry["adapter_factory"], MODULE.FavoriteQueueMixin))


if __name__ == "__main__":
    unittest.main()
