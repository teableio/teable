# @ssa/ai — in-app AI assistant service

OpenAI-compatible assistant backend for the SSA Teable instance. The web app
reaches it through the backend proxy (`/api/ssa/assistant/*`, session-gated),
so the LLM key never leaves the server.

```
Web UI (assistant drawer)
   └─ POST /api/ssa/assistant/chat      (Nest proxy, user session required)
        └─ POST /chat                   (this service, X-SSA-Token)
             └─ LLM endpoint            (OpenCode gateway / DeepSeek / Ollama)
                  └─ tool calls ────────▶ Teable REST API (PAT)
```

## Run

```bash
cd ssa && pnpm install
cd services/ai && cp .env.example .env   # or create from docs/ssa/ENVIRONMENT.md §4
pnpm dev                                  # http://127.0.0.1:4700
```

## Configuration

| Variable                                                       | Purpose                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `SSA_PORT` / `SSA_BIND`                                        | bind address (default `127.0.0.1:4700`)                                                   |
| `SSA_INTERNAL_TOKEN`                                           | shared token for `/chat` (`X-SSA-Token`); unset ⇒ disabled                                |
| `SSA_AI_BASE_URL`                                              | any OpenAI-compatible endpoint incl. `/v1` (OpenCode gateway preferred, DeepSeek, Ollama) |
| `SSA_AI_API_KEY`                                               | key for that endpoint (may be blank for keyless local models)                             |
| `SSA_AI_MODEL`                                                 | model id, e.g. `deepseek-chat`, `qwen2.5:14b`                                             |
| `SSA_AI_TEMPERATURE`, `SSA_AI_MAX_STEPS`, `SSA_AI_MAX_HISTORY` | agent behaviour                                                                           |
| `SSA_AI_SYSTEM_PROMPT`                                         | extra operator instructions appended to the system prompt                                 |
| `SSA_AI_ENABLED`                                               | `false` ⇒ all chats return 503                                                            |
| `SSA_TEABLE_BASE_URL` / `SSA_TEABLE_API_TOKEN`                 | data access; use a scoped personal access token                                           |

Any secret manager can inject these (`.env` in dev, host env vars, or
`npx wrangler secret put …` when deployed as a Worker variant).

## Tools exposed to the model

`list_tables` · `get_table_schema` · `query_records` · `create_records` ·
`update_records` — **no delete tool by design**. Reads use `fieldKeyType=name`
with text formatting; writes typecast against the schema. Values are grounded
in tool results (the prompt forbids inventing ids/values).

## HTTP

| Route          | Auth          | Purpose                             |
| -------------- | ------------- | ----------------------------------- | ------ | ------- | -------------------------------------------------------------------------- |
| `GET /healthz` | none          | enabled/model/tools/config presence |
| `POST /chat`   | `X-SSA-Token` | SSE stream: `{type:'text'           | 'tool' | 'error' | 'done'}`events, ends with`[DONE]`; `{"stream":false}` returns a JSON reply |

## Tests

`pnpm test` — SSE parsing + tool-call assembly (openai.spec), tool executor
validation and context fallbacks (tools.spec), and the agent loop with
scripted models (agent.spec). No network access required.
