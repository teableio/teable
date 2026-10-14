import type { ILogger } from './logger.js';

export interface IFunctionToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface IToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface IChatMessage {
  role: ChatRole;
  content?: string | null;
  tool_calls?: IToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface IModelDelta {
  /** Text emitted by the model. */
  text?: string;
  /** Accumulated tool call chunk (index identifies the call). */
  toolCallChunk?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  finishReason?: string;
}

export interface IModelClient {
  streamChat(params: {
    messages: IChatMessage[];
    tools?: IFunctionToolSpec[];
    signal?: AbortSignal;
  }): AsyncGenerator<IModelDelta>;
}

interface IStreamToolCallChunk {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface IStreamChoice {
  delta?: {
    content?: string | null;
    tool_calls?: IStreamToolCallChunk[];
  };
  finish_reason?: string | null;
}

const parseSseLines = (buffer: string): { events: string[]; rest: string } => {
  const events: string[] = [];
  let rest = buffer;
  let index = rest.indexOf('\n\n');
  while (index >= 0) {
    events.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
    index = rest.indexOf('\n\n');
  }
  return { events, rest };
};

/**
 * Minimal streaming client for any OpenAI-compatible `/chat/completions`
 * endpoint (OpenCode gateway, DeepSeek, Ollama, …). No SDK dependency.
 */
export const createModelClient = (
  config: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    timeoutMs: number;
  },
  logger: ILogger,
  fetchImpl: typeof fetch = fetch
): IModelClient => {
  return {
    async *streamChat({ messages, tools, signal }): AsyncGenerator<IModelDelta> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort);

      try {
        const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            temperature: config.temperature,
            stream: true,
            messages,
            ...(tools?.length ? { tools } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const body = await response.text().catch(() => '');
          throw new Error(`model endpoint HTTP ${response.status}: ${body.slice(0, 400)}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          const { events, rest } = parseSseLines(buffer);
          buffer = rest;

          for (const rawEvent of events) {
            for (const line of rawEvent.split('\n')) {
              if (!line.startsWith('data:')) {
                continue;
              }
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') {
                continue;
              }
              let parsed: { choices?: IStreamChoice[] };
              try {
                parsed = JSON.parse(payload) as { choices?: IStreamChoice[] };
              } catch {
                logger.debug('skipping non-JSON stream payload', {
                  payload: payload.slice(0, 120),
                });
                continue;
              }
              const choice = parsed.choices?.[0];
              if (!choice) {
                continue;
              }
              const delta = choice.delta ?? {};
              if (delta.content) {
                yield { text: delta.content };
              }
              for (const toolCall of delta.tool_calls ?? []) {
                yield {
                  toolCallChunk: {
                    index: toolCall.index,
                    id: toolCall.id,
                    name: toolCall.function?.name,
                    argumentsDelta: toolCall.function?.arguments,
                  },
                };
              }
              if (choice.finish_reason) {
                yield { finishReason: choice.finish_reason };
              }
            }
          }
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
};
