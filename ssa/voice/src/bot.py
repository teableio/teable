"""Pipecat voice agent for SSA.

Pipeline: transport (local mic/speaker or carrier audio) -> STT -> LLM (+tools)
-> TTS -> transport.

Run local (no carrier, mic/speaker):

    SSA_VOICE_MODE=local python src/bot.py

Telephony mode wires a carrier (Twilio Media Streams / Plivo) via a Pipecat
serializer; see docs/ssa/DEPLOY.md §voice and the upstream Pipecat guides. The
conversation logic (tools, prompt, logging) is identical in both modes.

Targets Pipecat 1.x service classes. If an import drifts upstream, run
`pipecat init` for a current scaffold — the pipeline shape below maps 1:1.
"""

from __future__ import annotations

import asyncio
import os
import sys

from .config import load_config
from .teable import TeableClient
from .tools import TOOL_SCHEMAS, ToolContext, build_tool_dispatcher

try:  # Pipecat is optional: the logging/tools core works without it.
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineParams, PipelineTask
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
    from pipecat.services.cartesia.tts import CartesiaTTSService
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.openai.llm import OpenAILLMService
    from pipecat.transports.local.audio import (
        LocalAudioTransport,
        LocalAudioTransportParams,
    )

    PIPECAT_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only without pipecat installed
    PIPECAT_AVAILABLE = False


SYSTEM_PROMPT = """You are {agent_name}, a phone assistant for {company}.
{disclosure}
Be brief, warm and factual. Never invent details: use lookup_contact before
referring to account specifics. When the conversation has a concrete result,
call log_call_outcome once with a short summary, then call end_call.
Keep every turn under three sentences; this is a phone call."""

DEFAULT_CARTESIA_VOICE = "79a125e8-cd45-4c13-8a67-188112f4dd22"  # Cartesia "British Lady"


def _require_pipecat() -> None:
    if not PIPECAT_AVAILABLE:
        print(
            "Pipecat is not installed. Install voice dependencies first:\n"
            "  cd ssa/voice && pip install -r requirements.txt\n"
            "  (or: uv sync)\n"
            "The tool/logging core runs without it: python scripts/log_test_call.py",
            file=sys.stderr,
        )
        raise SystemExit(2)


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required for local voice mode (see .env.example)")
    return value


async def run_local_agent() -> None:
    _require_pipecat()

    config = load_config()
    client = TeableClient(config.teable_base_url, config.teable_api_token)
    tool_context = ToolContext(client=client, call_log_table_id=config.call_log_table_id)
    dispatch = build_tool_dispatcher(tool_context)

    transport = LocalAudioTransport(
        LocalAudioTransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        )
    )

    stt = DeepgramSTTService(api_key=_require_env("DEEPGRAM_API_KEY"))
    tts_key = os.environ.get("CARTESIA_API_KEY")
    if not tts_key:
        raise SystemExit("CARTESIA_API_KEY is required for local voice mode")
    tts = CartesiaTTSService(api_key=tts_key, voice_id=DEFAULT_CARTESIA_VOICE)

    llm = OpenAILLMService(
        api_key=config.ai_api_key or "not-needed",
        base_url=config.ai_base_url or None,
        model=config.ai_model or "gpt-4o-mini",
    )

    for schema in TOOL_SCHEMAS:
        function_name = schema["function"]["name"]

        async def _handler(params, name=function_name):  # noqa: ANN001 - pipecat runtime types
            arguments = getattr(params, "arguments", "{}")
            result = dispatch(name, arguments)
            await params.result_callback(result.payload)

        llm.register_function(function_name, _handler)

    context = OpenAILLMContext(
        messages=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT.format(
                    agent_name=config.agent_name,
                    company="SSA",
                    disclosure=config.disclosure,
                ),
            }
        ],
        tools=TOOL_SCHEMAS,
    )
    context_aggregator = llm.create_context_aggregator(context)

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True, enable_metrics=True),
    )

    print(f"{config.agent_name} is listening (local mode) — speak into your mic.")
    await PipelineRunner().run(task)


def main() -> None:
    config = load_config()
    if config.voice_mode == "telephony":
        print(
            "Telephony mode needs the carrier wiring step (Twilio Media Streams or "
            "Plivo). See ssa/voice/README.md §4 and docs/ssa/DEPLOY.md §voice for "
            "the runbook; this scaffold runs `local` mode today.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    asyncio.run(run_local_agent())


if __name__ == "__main__":
    main()
