# SSA voice agent

Open-source voice layer for the SSA work app: AI phone agents that answer or
place calls (sales follow-ups, reminders, intake) and log structured outcomes
into Teable tables.

```
carrier (Twilio / Plivo)  ──▶  Pipecat pipeline  ──▶  STT ──▶  LLM ──▶  TTS
   (real phone calls)                                   │
                                                        └── tool calls ──▶ Teable REST
                                                            (lookup_contact, log_call_outcome)
```

- **Framework:** [Pipecat](https://github.com/pipecat-ai/pipecat) (BSD-2) —
  fully open source, self-hosted.
- **Telephony:** Twilio or Plivo (the one paid dependency; free trial credit is
  enough to test). Local mode needs no carrier at all.
- **Speech + LLM:** any OpenAI-compatible LLM (`SSA_AI_*`), plus configurable
  STT/TTS providers; local Whisper/Piper options documented below.

## What is verified vs. carrier-dependent

| Piece | Status |
|---|---|
| `src/teable.py`, `src/tools.py` | ✅ pure stdlib, unit-tested (`python -m unittest`) and run against a live Teable |
| `scripts/setup_call_log.py` | ✅ creates the Call Log table via the REST API |
| `scripts/log_test_call.py` | ✅ logs a full call outcome without any telephony |
| `src/bot.py` (Pipecat pipeline) | ⚙️ integration layer — needs a carrier + provider keys, see below |

## 1. Configure

```bash
cd ssa/voice
cp .env.example .env        # fill in Teable + LLM (+ carrier/provider keys for calls)
```

Key variables (full catalogue in `docs/ssa/ENVIRONMENT.md` §5):

| Variable | Purpose |
|---|---|
| `SSA_TEABLE_BASE_URL` / `SSA_TEABLE_API_TOKEN` | where outcomes are written |
| `SSA_CALL_LOG_TABLE_ID` | the Call Log table (created in step 2) |
| `SSA_AI_BASE_URL` / `SSA_AI_API_KEY` / `SSA_AI_MODEL` | the conversation LLM (OpenCode gateway / DeepSeek / Ollama) |
| `DEEPGRAM_API_KEY` | speech-to-text (or swap for local Whisper) |
| `CARTESIA_API_KEY` / `ELEVENLABS_API_KEY` | text-to-speech (or swap for local Piper) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | telephony mode |
| `SSA_VOICE_MODE` | `local` (mic/speaker) or `telephony` |

## 2. Create the Call Log table (once)

```bash
python scripts/setup_call_log.py --base bseXXXXXXXX
# prints: SSA_CALL_LOG_TABLE_ID=tblXXXXXXXX  → paste into .env
```

Columns: Contact, Phone, Direction, Outcome, Summary, Recording URL, When.

## 3. Prove the logging path (no phone needed)

```bash
python scripts/log_test_call.py
# → creates a "Call Log" record through the same tool functions the agent uses
```

## 4. Run the agent

Local mode (talk to it with your mic — zero carrier cost):

```bash
python -m venv .venv && .venv\Scripts\activate      # Windows (bash: source .venv/bin/activate)
pip install -r requirements.txt
# or with uv (recommended): uv sync
SSA_VOICE_MODE=local python src/bot.py
```

Telephony mode (Twilio): point your Twilio number's *A call comes in* webhook
(or Media Streams endpoint) at this service; see the runbook section in
`docs/ssa/DEPLOY.md`. Outbound calls: `scripts/twilio_outbound.md`.

> The Pipecat API moves fast. `src/bot.py` targets the Pipecat 1.x service
> classes; if an import drifts, `pipecat init` scaffolds a current project and
> the pipeline shape in `bot.py` (transport → STT → context → LLM → TTS → tools)
> maps 1:1 onto it.

## 5. LLM tools exposed during calls

| Tool | Effect |
|---|---|
| `lookup_contact` | search a table for a phone number / name |
| `log_call_outcome` | write a Call Log row (outcome, summary, next step) |
| `end_call` | hang up politely when the conversation is done |

Prompts must disclose that the caller talks to an AI and follow local consent
rules (see runbook).

## Costs & alternatives (all optional)

- Telephony: Twilio free trial ≈ $15 credit; inbound numbers ~$1.15/mo.
- STT/TTS: Deepgram + Cartesia scale-to-zero pricing; local Whisper (faster-whisper)
  and Piper TTS are free but need a GPU/CPU budget.
- LLM: the same OpenAI-compatible endpoint as the assistant — a small model is
  plenty for scripted calls.
