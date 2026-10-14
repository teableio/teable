"""Minimal Teable REST client for the voice agent (stdlib only)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class TeableError(RuntimeError):
    """Raised when the Teable API returns a non-2xx response."""


class TeableClient:
    def __init__(self, base_url: str, token: str, timeout: float = 15.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        query: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("accept", "application/json")
        if data is not None:
            request.add_header("content-type", "application/json")
        if self.token:
            request.add_header("authorization", f"Bearer {self.token}")

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:300]
            raise TeableError(f"Teable API {method} {path} -> HTTP {error.code} {detail}") from error
        except urllib.error.URLError as error:
            raise TeableError(f"Teable API {method} {path} unreachable: {error.reason}") from error

        return json.loads(payload) if payload else None

    # ── building blocks ─────────────────────────────────────────────────────

    def list_tables(self, base_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/api/base/{base_id}/table")

    def create_table(
        self,
        base_id: str,
        name: str,
        fields: list[dict[str, Any]],
        records: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/base/{base_id}/table",
            body={"name": name, "fields": fields, "records": records or []},
        )

    def query_records(
        self,
        table_id: str,
        *,
        take: int = 10,
        search: str | None = None,
        view_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = {
            "fieldKeyType": "name",
            "cellFormat": "text",
            "take": str(min(max(take, 1), 50)),
        }
        if view_id:
            query["viewId"] = view_id
        if search:
            query["search"] = json.dumps([search, search])
        result = self._request("GET", f"/api/table/{table_id}/record", query=query)
        return result.get("records", [])

    def create_records(self, table_id: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = self._request(
            "POST",
            f"/api/table/{table_id}/record",
            body={"records": records, "fieldKeyType": "name", "typecast": True},
        )
        return result.get("records", [])

    def update_records(self, table_id: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result = self._request(
            "PATCH",
            f"/api/table/{table_id}/record",
            body={"records": records, "fieldKeyType": "name", "typecast": True},
        )
        return result.get("records", [])
