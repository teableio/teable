import { describe, expect, it } from 'vitest';
import { findDuplicateProviderModel, findProviderForModelKey, isFullModelKey } from './model-key';

describe('isFullModelKey', () => {
  it('accepts exactly three non-empty segments', () => {
    expect(isFullModelKey('openai@gpt-4o@teable')).toBe(true);
    expect(isFullModelKey('openai@gpt-4o')).toBe(false);
    expect(isFullModelKey('openai@@teable')).toBe(false);
    expect(isFullModelKey('openai@gpt-4o@teable@extra')).toBe(false);
    expect(isFullModelKey(undefined)).toBe(false);
    expect(isFullModelKey('')).toBe(false);
  });
});

describe('findProviderForModelKey', () => {
  // Two instance providers share the name every instance provider gets; only the model tells them apart.
  const gpt = { type: 'openai', name: 'teable', models: 'gpt-5.5, gpt-6-astra' };
  const deepseek = { type: 'openai', name: 'teable', models: 'deepseek-flash' };

  it('returns the provider of that type and name which lists the model', () => {
    expect(findProviderForModelKey([gpt, deepseek], 'openai@deepseek-flash@teable')).toBe(deepseek);
    expect(findProviderForModelKey([gpt, deepseek], 'OpenAI@gpt-6-astra@Teable')).toBe(gpt);
  });

  it('returns nothing for a model no provider of that name lists, or a malformed key', () => {
    expect(findProviderForModelKey([gpt, deepseek], 'openai@o9@teable')).toBeUndefined();
    expect(findProviderForModelKey([gpt, deepseek], 'openai@gpt-5.5')).toBeUndefined();
    expect(findProviderForModelKey(undefined, 'openai@gpt-5.5@teable')).toBeUndefined();
  });

  it("falls back to a space's only provider of that type and name for a model it does not list", () => {
    const zai = { type: 'zhipu', name: 'Z.AI', models: 'GLM-5.2' };
    expect(findProviderForModelKey([zai, gpt], 'zhipu@glm-5-turbo@Z.AI')).toBe(zai);
  });

  it('does not guess between space providers sharing a type and name', () => {
    const first = { type: 'openai', name: 'mine', models: 'gpt-5.5' };
    const second = { type: 'openai', name: 'mine', models: 'gpt-6-astra' };
    expect(findProviderForModelKey([first, second], 'openai@o9@mine')).toBeUndefined();
  });

  it('never falls back to an instance provider', () => {
    expect(findProviderForModelKey([gpt], 'openai@o9@teable')).toBeUndefined();
  });
});

describe('findDuplicateProviderModel', () => {
  it('passes providers of one name whose models do not overlap', () => {
    expect(
      findDuplicateProviderModel([
        { type: 'openai', name: 'teable', models: 'gpt-5.5' },
        { type: 'openai', name: 'teable', models: 'deepseek-flash' },
        // Another type may list the same model: its keys differ.
        { type: 'anthropic', name: 'teable', models: 'gpt-5.5' },
      ])
    ).toBeUndefined();
  });

  it('names the model and both providers when one type and name list it twice', () => {
    expect(
      findDuplicateProviderModel([
        { type: 'openai', name: 'teable', displayName: 'GPT', models: 'gpt-5.5' },
        { type: 'openai', name: 'Teable', models: 'deepseek-flash, gpt-5.5 ' },
      ])
    ).toEqual({ model: 'gpt-5.5', providers: ['GPT', 'Teable'] });
  });
});
