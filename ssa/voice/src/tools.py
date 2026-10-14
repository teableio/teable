"""LLM tool functions for the voice agent.

These are plain functions over a Teable client so they can be unit-tested and
reused by any agent runtime (Pipecat, a scripted flow, or a webhook handler).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from .teable import TeableClient


@dataclass(frozen=True)
class ToolContext:
    client: TeableClient
    call_log_table_id: str
    contacts_table_id: str | None = None
    owner_name: str = "SSA"


@dataclass(frozen=True)
class ToolResult:
    ok: bool
    payload: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(self.payload, ensure_ascii=False)


def lookup_contact(context: ToolContext, *, query: str) -> ToolResult:
    """Find a contact by phone number or name (returns up to 5 matches)."""
    if not context.contacts_table_id:
        return ToolResult(ok=False, payload={"error": "contacts table is not configured"})
    if not query.strip():
        return ToolResult(ok=False, payload={"error": "query is required"})

    records = context.client.query_records(context.contacts_table_id, take=5, search=query)
    hits = [{"id": record.get("id"), "fields": record.get("fields", {})} for record in records]
    return ToolResult(ok=True, payload={"count": len(hits), "contacts": hits})


def log_call_outcome(
    context: ToolContext,
    *,
    summary: str,
    outcome: str = "completed",
    direction: str = "outbound",
    phone: str = "",
    contact: str = "",
    next_step: str = "",
    recording_url: str = "",
) -> ToolResult:
    """Write one Call Log row for the finished conversation."""
    if not context.call_log_table_id:
        return ToolResult(ok=False, payload={"error": "call log table is not configured"})

    when = datetime.now(timezone.utc).isoformat()
    fields: dict[str, Any] = {
        "When": when,
        "Direction": direction,
        "Outcome": outcome,
        "Summary": summary,
        "Contact": contact or phone or "unknown",
        "Phone": phone,
        "Next step": next_step,
        "Recording URL": recording_url,
    }
    created = context.client.create_records(context.call_log_table_id, [{"fields": fields}])
    record = created[0] if created else {}
    return ToolResult(ok=True, payload={"recordId": record.get("id"), "when": when})


def end_call(context: ToolContext, *, reason: str = "completed") -> ToolResult:
    """Signal that the conversation is finished (the runtime hangs up)."""
    return ToolResult(ok=True, payload={"ended": True, "reason": reason})


TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "lookup_contact",
            "description": "Search the contacts table by phone number or name.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "log_call_outcome",
            "description": (
                "Record the call result in the Call Log table. Call this once before ending "
                "the conversation, with a short factual summary."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "outcome": {
                        "type": "string",
                        "description": "e.g. completed | no_answer | callback | not_interested | booked",
                    },
                    "direction": {"type": "string", "enum": ["inbound", "outbound"]},
                    "phone": {"type": "string"},
                    "contact": {"type": "string"},
                    "next_step": {"type": "string"},
                    "recording_url": {"type": "string"},
                },
                "required": ["summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "end_call",
            "description": "Politely end the call when the conversation is complete.",
            "parameters": {
                "type": "object",
                "properties": {"reason": {"type": "string"}},
            },
        },
    },
]


def build_tool_dispatcher(context: ToolContext) -> Callable[[str, str], ToolResult]:
    """Returns dispatch(name, arguments_json) used by the agent runtime."""

    handlers: dict[str, Callable[..., ToolResult]] = {
        "lookup_contact": lookup_contact,
        "log_call_outcome": log_call_outcome,
        "end_call": end_call,
    }

    def dispatch(name: str, arguments_json: str) -> ToolResult:
        handler = handlers.get(name)
        if handler is None:
            return ToolResult(ok=False, payload={"error": f"unknown tool: {name}"})
        try:
            arguments = json.loads(arguments_json) if arguments_json else {}
            if not isinstance(arguments, dict):
                raise ValueError("arguments must be a JSON object")
            return handler(context, **arguments)
        except TypeError as error:
            return ToolResult(ok=False, payload={"error": f"bad arguments: {error}"})
        except json.JSONDecodeError as error:
            return ToolResult(ok=False, payload={"error": f"invalid JSON: {error.msg}"})
        except Exception as error:  # noqa: BLE001 - surfaced to the model, not raised
            return ToolResult(ok=False, payload={"error": str(error)})

    return dispatch
