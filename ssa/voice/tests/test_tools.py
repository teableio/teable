"""Unit tests for the voice agent tool core (no network, no pipecat)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.tools import ToolContext, build_tool_dispatcher  # noqa: E402


class StubClient:
    def __init__(self) -> None:
        self.queried: list[tuple[str, dict]] = []
        self.created: list[tuple[str, list]] = []

    def query_records(self, table_id: str, **kwargs):
        self.queried.append((table_id, kwargs))
        return [
            {"id": "rec1", "fields": {"Name": "Acme Sdn Bhd", "Phone": "+60123456789"}}
        ]

    def create_records(self, table_id: str, records: list):
        self.created.append((table_id, records))
        return [{"id": "log1", "fields": records[0]["fields"]}]


def make_context(**overrides) -> ToolContext:
    base = {
        "client": StubClient(),
        "call_log_table_id": "tblLog",
        "contacts_table_id": "tblContacts",
    }
    base.update(overrides)
    return ToolContext(**base)


class ToolDispatcherTests(unittest.TestCase):
    def test_unknown_tool_is_reported(self) -> None:
        dispatch = build_tool_dispatcher(make_context())
        result = dispatch("nope", "{}")
        self.assertFalse(result.ok)
        self.assertIn("unknown tool", result.payload["error"])

    def test_invalid_json_is_reported(self) -> None:
        dispatch = build_tool_dispatcher(make_context())
        result = dispatch("log_call_outcome", "{not json")
        self.assertFalse(result.ok)
        self.assertIn("invalid JSON", result.payload["error"])

    def test_bad_arguments_are_reported(self) -> None:
        dispatch = build_tool_dispatcher(make_context())
        result = dispatch("log_call_outcome", '{"unexpected": true}')
        self.assertFalse(result.ok)
        self.assertIn("bad arguments", result.payload["error"])

    def test_lookup_contact_searches_and_returns_hits(self) -> None:
        context = make_context()
        dispatch = build_tool_dispatcher(context)
        result = dispatch("lookup_contact", json.dumps({"query": "+60123456789"}))

        self.assertTrue(result.ok)
        self.assertEqual(result.payload["count"], 1)
        self.assertEqual(context.client.queried[0][0], "tblContacts")
        self.assertEqual(context.client.queried[0][1]["search"], "+60123456789")

    def test_lookup_without_contacts_table_fails_cleanly(self) -> None:
        dispatch = build_tool_dispatcher(make_context(contacts_table_id=None))
        result = dispatch("lookup_contact", json.dumps({"query": "x"}))
        self.assertFalse(result.ok)
        self.assertIn("contacts table", result.payload["error"])

    def test_log_call_outcome_writes_the_documented_fields(self) -> None:
        context = make_context()
        dispatch = build_tool_dispatcher(context)
        result = dispatch(
            "log_call_outcome",
            json.dumps(
                {
                    "summary": "Interested, wants a quote",
                    "outcome": "callback",
                    "direction": "outbound",
                    "phone": "+60123456789",
                    "contact": "Acme",
                    "next_step": "send quote",
                }
            ),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.payload["recordId"], "log1")
        table_id, records = context.client.created[0]
        self.assertEqual(table_id, "tblLog")
        fields = records[0]["fields"]
        self.assertEqual(fields["Outcome"], "callback")
        self.assertEqual(fields["Summary"], "Interested, wants a quote")
        self.assertEqual(fields["Next step"], "send quote")
        self.assertIn("When", fields)

    def test_log_without_table_fails_cleanly(self) -> None:
        dispatch = build_tool_dispatcher(make_context(call_log_table_id=""))
        result = dispatch("log_call_outcome", json.dumps({"summary": "x"}))
        self.assertFalse(result.ok)
        self.assertIn("call log table", result.payload["error"])

    def test_end_call_is_successful(self) -> None:
        dispatch = build_tool_dispatcher(make_context())
        result = dispatch("end_call", json.dumps({"reason": "done"}))
        self.assertTrue(result.ok)
        self.assertTrue(result.payload["ended"])


if __name__ == "__main__":
    unittest.main()
