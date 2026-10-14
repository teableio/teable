"""Log a full call outcome without any telephony — proves the tools core.

Usage: python scripts/log_test_call.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import load_config  # noqa: E402
from src.teable import TeableClient  # noqa: E402
from src.tools import ToolContext, build_tool_dispatcher  # noqa: E402


def main() -> None:
    config = load_config()
    if not config.call_log_table_id:
        print(
            "SSA_CALL_LOG_TABLE_ID is not set. Run scripts/setup_call_log.py first.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    tool_context = ToolContext(
        client=TeableClient(config.teable_base_url, config.teable_api_token),
        call_log_table_id=config.call_log_table_id,
    )
    dispatch = build_tool_dispatcher(tool_context)

    result = dispatch(
        "log_call_outcome",
        (
            '{"summary": "Smoke test from scripts/log_test_call.py — agent wiring OK",'
            ' "outcome": "completed", "direction": "outbound",'
            ' "phone": "+60123456789", "contact": "Test Contact",'
            ' "next_step": "none"}'
        ),
    )
    print(result.to_json())
    raise SystemExit(0 if result.ok else 1)


if __name__ == "__main__":
    main()
