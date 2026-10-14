import type { ILogger } from './logger.js';
import type { IChatMessage, IModelClient, IToolCall } from './openai.js';
import type { IToolExecutor } from './tools.js';

export interface IAssistantContext {
  baseId?: string;
  baseName?: string;
  tableId?: string;
  tableName?: string;
  viewId?: string;
}

export type IAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; status: 'start' | 'ok' | 'error'; preview?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; steps: number };

export const buildSystemPrompt = (
  context: IAssistantContext | undefined,
  extra?: string
): string => {
  const lines = [
    'You are the SSA work-assistant embedded in a Teable workspace (monday.com-style data app).',
    'Answer questions about the workspace data and perform write operations that the user explicitly asks for.',
    '',
    'Rules:',
    '- Ground every factual claim in tool results; never invent record ids, field names or values.',
    '- Use `get_table_schema` before `create_records`/`update_records` so field names and types are correct.',
    '- Read with `query_records` (`fieldKeyType` is by name; values are display strings). Prefer views the user mentions (pass their viewId).',
    '- You can create and update records, but you cannot delete anything.',
    '- Be concise. Use short markdown. When you change data, state exactly which records changed (ids + key fields).',
  ];

  if (context?.baseId || context?.tableId) {
    lines.push('', 'Current context:');
    if (context.baseName || context.baseId) {
      lines.push(`- Base: ${context.baseName ?? 'unknown'} (${context.baseId})`);
    }
    if (context.tableName || context.tableId) {
      lines.push(`- Table: ${context.tableName ?? 'unknown'} (${context.tableId})`);
    }
    if (context.viewId) {
      lines.push(`- View: ${context.viewId}`);
    }
  }

  if (extra) {
    lines.push('', extra);
  }

  return lines.join('\n');
};

const MAX_TOOL_RESULT_CHARS = 20_000;

const capJson = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > MAX_TOOL_RESULT_CHARS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`
    : text;
};

/**
 * Streaming tool-calling loop. Yields text deltas as they arrive and tool
 * activity events around each execution; the caller owns transport (SSE).
 */
export async function* runAgent(params: {
  history: { role: 'user' | 'assistant'; content: string }[];
  context?: IAssistantContext;
  model: IModelClient;
  tools: IToolExecutor;
  logger: ILogger;
  maxSteps: number;
  maxHistory: number;
  systemPromptExtra?: string;
}): AsyncGenerator<IAgentEvent> {
  const { context, model, tools, logger, maxSteps, maxHistory } = params;

  const messages: IChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(context, params.systemPromptExtra) },
    ...params.history.slice(-maxHistory).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  for (let step = 1; step <= maxSteps; step++) {
    const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
    let assistantText = '';

    try {
      for await (const delta of model.streamChat({ messages, tools: tools.specs })) {
        if (delta.text) {
          assistantText += delta.text;
          yield { type: 'text', text: delta.text };
        }
        if (delta.toolCallChunk) {
          const { index, id, name, argumentsDelta } = delta.toolCallChunk;
          const call = toolCalls.get(index) ?? { arguments: '' };
          if (id) {
            call.id = id;
          }
          if (name) {
            call.name = name;
          }
          call.arguments += argumentsDelta ?? '';
          toolCalls.set(index, call);
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
      return;
    }

    if (toolCalls.size === 0) {
      messages.push({ role: 'assistant', content: assistantText || null });
      yield { type: 'done', steps: step };
      return;
    }

    const calls: IToolCall[] = [...toolCalls.values()].map((call, index) => ({
      id: call.id ?? `call_${step}_${index}`,
      type: 'function',
      function: { name: call.name ?? 'unknown', arguments: call.arguments },
    }));
    messages.push({ role: 'assistant', content: assistantText || null, tool_calls: calls });

    for (const call of calls) {
      yield { type: 'tool', name: call.function.name, status: 'start' };
      const outcome = await tools.execute(call.function.name, call.function.arguments);
      logger.debug('tool executed', {
        name: call.function.name,
        ok: outcome.ok,
      });
      yield {
        type: 'tool',
        name: call.function.name,
        status: outcome.ok ? 'ok' : 'error',
        preview: capJson(outcome.result).slice(0, 300),
      };
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: capJson(outcome.result),
      });
    }
  }

  yield {
    type: 'error',
    message: `stopped after ${maxSteps} tool steps — ask a narrower question`,
  };
  yield { type: 'done', steps: maxSteps };
}
