"""Create the SSA Call Log table in a Teable base (idempotent-ish).

Usage:
    python scripts/setup_call_log.py --base bseXXXXXXXX [--name "Call Log"]

Prints `SSA_CALL_LOG_TABLE_ID=...` on success — paste it into ssa/voice/.env.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import load_config  # noqa: E402
from src.teable import TeableClient, TeableError  # noqa: E402

CALL_LOG_FIELDS = [
    {"name": "Contact", "type": "singleLineText"},
    {"name": "Phone", "type": "singleLineText"},
    {"name": "Direction", "type": "singleLineText"},
    {"name": "Outcome", "type": "singleLineText"},
    {"name": "Summary", "type": "longText"},
    {"name": "Next step", "type": "singleLineText"},
    {"name": "Recording URL", "type": "singleLineText"},
    {"name": "When", "type": "singleLineText"},
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the Call Log table")
    parser.add_argument("--base", required=True, help="Base id (bse…)")
    parser.add_argument("--name", default="Call Log")
    arguments = parser.parse_args()

    config = load_config()
    client = TeableClient(config.teable_base_url, config.teable_api_token)

    existing = {table.get("name") for table in client.list_tables(arguments.base)}
    if arguments.name in existing:
        tables = client.list_tables(arguments.base)
        table = next(item for item in tables if item.get("name") == arguments.name)
        print(f"Table already exists: SSA_CALL_LOG_TABLE_ID={table['id']}")
        return

    try:
        table = client.create_table(arguments.base, arguments.name, CALL_LOG_FIELDS)
    except TeableError as error:
        print(f"Failed to create the table: {error}", file=sys.stderr)
        raise SystemExit(1) from error

    print(f"Created '{arguments.name}': SSA_CALL_LOG_TABLE_ID={table['id']}")


if __name__ == "__main__":
    main()
