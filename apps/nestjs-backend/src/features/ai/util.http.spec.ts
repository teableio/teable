import {
  isMiniMaxMessagesEndpoint,
  LLMProviderType,
  MINIMAX_DEFAULT_MODEL_CONFIGS,
  MINIMAX_MODEL_IDS,
  MINIMAX_PROVIDER_ENDPOINTS,
} from '@teable/openapi';
import { generateText, jsonSchema, streamText, tool } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdaptedProviderOptions, modelProviders, setInstanceAiProviderOriginsResolver } from './util';

const apiKey = 'offline-test-key';
const modelIds = [...MINIMAX_MODEL_IDS, 'MiniMax-M2.7', 'saved-custom-model'];
const endpoints = [
  ...MINIMAX_PROVIDER_ENDPOINTS.map(({ baseUrl }) => baseUrl),
  'https://proxy.example.test/v1',
  'https://proxy.example.test/anthropic/v1/',
];

const responseBody = (messages: boolean) =>
  messages
    ? {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 1 },
      }
    : {
        id: 'chat_test',
        object: 'chat.completion',
        created: 1,
        model: 'test',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      };

// This follows AiService's configured provider -> SDK model path, replacing only HTTP.
const getModel = (baseURL: string, modelId: string) =>
  modelProviders[LLMProviderType.MINIMAX](
    getAdaptedProviderOptions(LLMProviderType.MINIMAX, { name: modelId, baseURL, apiKey }) as never
  )(modelId);

beforeEach(() => setInstanceAiProviderOriginsResolver(async () => endpoints));
afterEach(() => {
  setInstanceAiProviderOriginsResolver(async () => []);
  vi.unstubAllGlobals();
});

describe('MiniMax serialized requests', () => {
  it('has Flash first with direct API metadata and no invented cache-write rate', () => {
    expect(MINIMAX_MODEL_IDS).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(MINIMAX_DEFAULT_MODEL_CONFIGS['MiniMax-M3.1-Flash']).toMatchObject({
      contextWindow: 1_000_000,
      maxTokens: 524_288,
      ability: { image: true, reasoning: true },
      pricing: { input: '0.00000015', output: '0.0000006', inputCacheRead: '0.000000015' },
    });
    expect(MINIMAX_DEFAULT_MODEL_CONFIGS['MiniMax-M3.1-Flash'].pricing).not.toHaveProperty(
      'inputCacheWrite'
    );
  });

  for (const baseURL of endpoints) {
    for (const modelId of modelIds) {
      it(`preserves ${modelId} through ${baseURL}`, async () => {
        const messagesProtocol = isMiniMaxMessagesEndpoint(baseURL);
        const transport = vi.fn(async () => Response.json(responseBody(messagesProtocol)));
        vi.stubGlobal('fetch', transport);
        const result = await generateText({
          model: getModel(baseURL, modelId),
          maxRetries: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Read this image and use lookup.' },
                { type: 'image', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
              ],
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCallId: 'call_1',
                  toolName: 'lookup',
                  input: { key: 'x' },
                },
              ],
            },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'call_1',
                  toolName: 'lookup',
                  output: { type: 'json', value: { found: true } },
                },
              ],
            },
          ],
          tools: {
            lookup: tool({
              inputSchema: jsonSchema({ type: 'object', properties: { key: { type: 'string' } } }),
            }),
          },
        });
        expect(result.text).toBe('ok');
        expect(transport).toHaveBeenCalledTimes(1);
        const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
        expect(String(url)).toBe(
          `${baseURL.replace(/\/$/, '')}/${messagesProtocol ? 'messages' : 'chat/completions'}`
        );
        const headers = new Headers(init.headers);
        expect(headers.get(messagesProtocol ? 'x-api-key' : 'authorization')).toBe(
          messagesProtocol ? apiKey : `Bearer ${apiKey}`
        );
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe(modelId);
        expect(body).not.toHaveProperty('service_tier');
        expect(body).not.toHaveProperty('reasoning_split');
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body).not.toHaveProperty('thinking');
        expect(body).not.toHaveProperty('output_config');
        expect(body.tools).toHaveLength(1);
        expect(JSON.stringify(body.messages)).toContain('image');
        expect(JSON.stringify(body.messages)).toContain('AQID');
        expect(JSON.stringify(body.messages)).toContain('call_1');
        expect(JSON.stringify(body.messages)).toContain('found');
      });
    }
  }

  it.each([false, true])('streams Flash with messages protocol=%s', async (messagesProtocol) => {
    const baseURL = MINIMAX_PROVIDER_ENDPOINTS[messagesProtocol ? 2 : 0].baseUrl;
    const events = messagesProtocol
      ? [
          [
            'message_start',
            { type: 'message_start', message: { ...responseBody(true), content: [] } },
          ],
          [
            'content_block_start',
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          ],
          [
            'content_block_delta',
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
          ],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          [
            'message_delta',
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 1 },
            },
          ],
          ['message_stop', { type: 'message_stop' }],
        ]
          .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          .join('')
      : `data: ${JSON.stringify({ id: 'chat_test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'chat_test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    const transport = vi.fn(
      async () => new Response(events, { headers: { 'content-type': 'text/event-stream' } })
    );
    vi.stubGlobal('fetch', transport);
    const result = streamText({
      model: getModel(baseURL, MINIMAX_MODEL_IDS[0]),
      prompt: 'Hello',
      maxRetries: 0,
    });
    expect(await result.text).toBe('ok');
    const [, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: MINIMAX_MODEL_IDS[0],
      stream: true,
    });
  });
});
