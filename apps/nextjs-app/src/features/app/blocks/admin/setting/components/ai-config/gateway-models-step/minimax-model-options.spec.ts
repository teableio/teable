import { describe, expect, it } from 'vitest';
import { getMiniMaxModelOptions } from './minimax-model-options';

const flash = { id: 'minimax/minimax-m3.1-flash', type: 'language', maxTokens: 262144 };
const m3 = { id: 'minimax/minimax-m3', type: 'language', pricing: { input: '0.0000006' } };
const legacy = { id: 'minimax/minimax-m2.7', type: 'language' };
const other = { id: 'openai/gpt-5.2-chat', type: 'language' };
const image = { id: 'minimax/image-01', type: 'image' };

describe('MiniMax gateway choices', () => {
  it('offers Flash then M3 while retaining provider metadata and other modalities', () => {
    const catalog = [other, m3, legacy, flash, image];
    const options = getMiniMaxModelOptions(catalog, new Set());
    expect(options).toEqual([other, flash, m3, image]);
    expect(options[1]).toBe(flash);
    expect(options[2]).toBe(m3);
    expect(catalog).toEqual([other, m3, legacy, flash, image]);
  });

  it('keeps saved legacy and custom selections without adding unavailable routes', () => {
    const custom = { id: 'minimax/private-text', type: 'language' };
    const options = getMiniMaxModelOptions(
      [legacy, other, m3, custom],
      new Set([legacy.id, custom.id])
    );
    expect(options).toEqual([m3, other, legacy, custom]);
    expect(options).not.toContain(flash);
  });
});
