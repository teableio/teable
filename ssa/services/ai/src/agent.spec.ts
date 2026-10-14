import { describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, runAgent } from './agent.js';
import type { IAgentEvent } from './agent.js';
import { createLogger } from './logger.js';
import type { IModelClient, IModelDelta } from './openai.js';
import type { IToolExecutor } from './tools.js';

const logger = createLogger('error', 'test');

const scriptedModel = (scripts: IModelDelta[][]): IModelClient => {
  let call = 0;
  return {
    async *streamChat() {
      const script = scripts[Math.min(call, scripts.length - 1)];
      call++;
      for (const delta of script) {
        yield delta;
      }
    },
  };
};

const collect = async (events: AsyncGenerator<IAgentEvent>): Promise<IAgentEvent[]> => {
  const out: IAgentEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
};

describe('buildSystemPrompt', () => {
  it('includes context and the no-delete rule', () => {
    const prompt = buildSystemPrompt({
      baseId: 'bse1',
      baseName: 'Ops',
      tableId: 'tbl1',
      tableName: 'Tasks',
    });

    expect(prompt).toContain('Base: Ops (bse1)');
    expect(prompt).toContain('Table: Tasks (tbl1)');
    expect(prompt).toContain('cannot delete');
  });
});

describe('runAgent', () => {
  const tools: IToolExecutor = {
    specs: [
      { type: 'function', function: { name: 'query_records', description: '', parameters: {} } },
    ],
    execute: vi.fn(async () => ({ ok: true, result: { records: [{ id: 'rec1' }] } })),
  };

  it('runs a tool step then streams the final answer', async () => {
    const model = scriptedModel([
      [
        {
          toolCallChunk: {
            index: 0,
            id: 'c1',
            name: 'query_records',
            argumentsDelta: '{"take":1}',
          },
        },
        { finishReason: 'tool_calls' },
      ],
      [{ text: 'There is 1 record.' }, { finishReason: 'stop' }],
    ]);

    const events = await collect(
      runAgent({
        history: [{ role: 'user', content: 'how many records?' }],
        model,
        tools,
        logger,
        maxSteps: 5,
        maxHistory: 10,
      })
    );

    expect(events).toEqual([
      { type: 'tool', name: 'query_records', status: 'start' },
      { type: 'tool', name: 'query_records', status: 'ok', preview: '{"records":[{"id":"rec1"}]}' },
      { type: 'text', text: 'There is 1 record.' },
      { type: 'done', steps: 2 },
    ]);
    expect(tools.execute).toHaveBeenCalledWith('query_records', '{"take":1}');
  });

  it('reports model failures as error events', async () => {
    const failingModel: IModelClient = {
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error('endpoint down');
      },
    };

    const events = await collect(
      runAgent({
        history: [{ role: 'user', content: 'hi' }],
        model: failingModel,
        tools,
        logger,
        maxSteps: 2,
        maxHistory: 5,
      })
    );

    expect(events).toEqual([{ type: 'error', message: 'endpoint down' }]);
  });

  it('stops after maxSteps without an answer', async () => {
    const loopingModel = scriptedModel([
      [{ toolCallChunk: { index: 0, id: 'c1', name: 'query_records', argumentsDelta: '{}' } }],
    ]);

    const events = await collect(
      runAgent({
        history: [{ role: 'user', content: 'loop' }],
        model: loopingModel,
        tools,
        logger,
        maxSteps: 2,
        maxHistory: 5,
      })
    );

    expect(events.at(-1)).toEqual({ type: 'done', steps: 2 });
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });
});
