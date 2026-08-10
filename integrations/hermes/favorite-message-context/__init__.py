"""Inject the exact inbound Discord snowflake into the same Hermes turn.

Hermes binds gateway message metadata to ContextVars before starting the agent.
Reading that public session-context API preserves the event/turn relationship
across concurrent Discord messages without consulting history or patching
Hermes itself. The prompt hook explains the binding to the model, while a
``tool_request`` middleware enforces it immediately before tool execution.
"""

from __future__ import annotations

import re
from typing import Any

_DISCORD_SNOWFLAKE = re.compile(r"^[0-9]{17,20}$")
_INGEST_TOOL_NAME = "mcp__favorite_ingest__favorite_ingest"


def _session_message_id() -> str:
    try:
        from gateway.session_context import get_session_env
    except ImportError:
        return ""
    return get_session_env("HERMES_SESSION_MESSAGE_ID", "").strip()


def _inject_message_id(*, platform: str = "", **_: Any) -> dict[str, str] | None:
    if not str(platform).lower().endswith("discord"):
        return None

    message_id = _session_message_id()
    if not _DISCORD_SNOWFLAKE.fullmatch(message_id):
        return {
            "context": (
                "[Trusted Favorite gateway metadata: the current Discord message ID "
                "is unavailable. Do not call favorite_ingest for this turn.]"
            )
        }

    return {
        "context": (
            "[Trusted Favorite gateway metadata: current Discord message_id is "
            f"`{message_id}`. Preserve it as a string when calling favorite_ingest.]"
        )
    }


def _force_message_id(
    *, tool_name: str = "", args: dict[str, Any] | None = None, **_: Any
) -> dict[str, dict[str, Any]] | None:
    if tool_name != _INGEST_TOOL_NAME:
        return None

    effective_args = dict(args) if isinstance(args, dict) else {}
    message_id = _session_message_id()
    # The MCP schema rejects an empty messageId, so a missing or malformed
    # gateway binding fails closed before an HTTP request can be signed.
    effective_args["messageId"] = (
        message_id if _DISCORD_SNOWFLAKE.fullmatch(message_id) else ""
    )
    return {"args": effective_args}


def register(ctx: Any) -> None:
    ctx.register_hook("pre_llm_call", _inject_message_id)
    ctx.register_middleware("tool_request", _force_message_id)
