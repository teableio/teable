"""Typed environment loading for the SSA voice agent (stdlib only)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path: Path | None = None) -> None:
    """Load a simple KEY=VALUE .env file into os.environ (no overrides)."""
    env_path = path or Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class VoiceConfig:
    teable_base_url: str
    teable_api_token: str
    call_log_table_id: str
    ai_base_url: str
    ai_api_key: str
    ai_model: str
    voice_mode: str
    agent_name: str
    disclosure: str

    @property
    def tools_enabled(self) -> bool:
        return bool(self.teable_api_token and self.call_log_table_id)


def load_config() -> VoiceConfig:
    load_env_file()
    return VoiceConfig(
        teable_base_url=os.environ.get("SSA_TEABLE_BASE_URL", "http://127.0.0.1:3000"),
        teable_api_token=os.environ.get("SSA_TEABLE_API_TOKEN", ""),
        call_log_table_id=os.environ.get("SSA_CALL_LOG_TABLE_ID", ""),
        ai_base_url=os.environ.get("SSA_AI_BASE_URL", ""),
        ai_api_key=os.environ.get("SSA_AI_API_KEY", ""),
        ai_model=os.environ.get("SSA_AI_MODEL", ""),
        voice_mode=os.environ.get("SSA_VOICE_MODE", "local"),
        agent_name=os.environ.get("SSA_VOICE_AGENT_NAME", "SSA Assistant"),
        disclosure=os.environ.get(
            "SSA_VOICE_DISCLOSURE",
            "This call is handled by an AI assistant on behalf of SSA.",
        ),
    )
