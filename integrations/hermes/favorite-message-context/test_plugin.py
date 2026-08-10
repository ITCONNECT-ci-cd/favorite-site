from __future__ import annotations

import contextvars
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace


PLUGIN_PATH = Path(__file__).with_name("__init__.py")
SPEC = importlib.util.spec_from_file_location("favorite_message_context", PLUGIN_PATH)
assert SPEC is not None and SPEC.loader is not None
PLUGIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PLUGIN)


class FavoriteMessageContextTest(unittest.TestCase):
    def setUp(self) -> None:
        self.message_id = contextvars.ContextVar("test_message_id", default="")
        gateway = types.ModuleType("gateway")
        session_context = types.ModuleType("gateway.session_context")
        session_context.get_session_env = lambda _name, default="": self.message_id.get() or default
        gateway.session_context = session_context
        self.previous_gateway = sys.modules.get("gateway")
        self.previous_session_context = sys.modules.get("gateway.session_context")
        sys.modules["gateway"] = gateway
        sys.modules["gateway.session_context"] = session_context
        self.addCleanup(self._restore_modules)

    def _restore_modules(self) -> None:
        if self.previous_gateway is None:
            sys.modules.pop("gateway", None)
        else:
            sys.modules["gateway"] = self.previous_gateway
        if self.previous_session_context is None:
            sys.modules.pop("gateway.session_context", None)
        else:
            sys.modules["gateway.session_context"] = self.previous_session_context

    def test_reads_the_exact_gateway_bound_snowflake(self) -> None:
        self.message_id.set("1536000000000000004")

        result = PLUGIN._inject_message_id(platform="discord")

        self.assertIn("`1536000000000000004`", result["context"])

    def test_contexts_do_not_leak_between_concurrent_turns(self) -> None:
        first = contextvars.copy_context()
        second = contextvars.copy_context()
        first.run(self.message_id.set, "1536000000000000001")
        second.run(self.message_id.set, "1536000000000000002")

        self.assertIn(
            "`1536000000000000001`",
            first.run(PLUGIN._inject_message_id, platform="discord")["context"],
        )
        self.assertIn(
            "`1536000000000000002`",
            second.run(PLUGIN._inject_message_id, platform="discord")["context"],
        )

    def test_ignores_other_platforms_and_fails_closed_for_bad_ids(self) -> None:
        self.message_id.set("../../secret")
        result = PLUGIN._inject_message_id(platform="discord")
        self.assertIn("unavailable", result["context"])
        self.assertNotIn("../../secret", result["context"])
        self.assertIsNone(PLUGIN._inject_message_id(platform="slack"))

    def test_overrides_model_supplied_message_id_without_mutating_input(self) -> None:
        self.message_id.set("1536000000000000004")
        original = {"messageId": "1536000000000000999", "url": "https://example.com"}

        result = PLUGIN._force_message_id(
            tool_name="mcp__favorite_ingest__favorite_ingest", args=original
        )

        self.assertEqual(result["args"]["messageId"], "1536000000000000004")
        self.assertEqual(result["args"]["url"], "https://example.com")
        self.assertEqual(original["messageId"], "1536000000000000999")

    def test_tool_middleware_ignores_other_tools_and_fails_closed(self) -> None:
        self.message_id.set("not-a-snowflake")

        result = PLUGIN._force_message_id(
            tool_name="mcp__favorite_ingest__favorite_ingest",
            args={"messageId": "1536000000000000999"},
        )

        self.assertEqual(result, {"args": {"messageId": ""}})
        self.assertIsNone(
            PLUGIN._force_message_id(
                tool_name="favorite_list_categories", args={"category": "all"}
            )
        )

    def test_registers_prompt_hook_and_tool_middleware(self) -> None:
        registered_hooks: list[tuple[str, object]] = []
        registered_middleware: list[tuple[str, object]] = []
        context = SimpleNamespace(
            register_hook=lambda name, callback: registered_hooks.append((name, callback)),
            register_middleware=lambda name, callback: registered_middleware.append(
                (name, callback)
            ),
        )

        PLUGIN.register(context)

        self.assertEqual(
            registered_hooks, [("pre_llm_call", PLUGIN._inject_message_id)]
        )
        self.assertEqual(
            registered_middleware, [("tool_request", PLUGIN._force_message_id)]
        )


if __name__ == "__main__":
    unittest.main()
