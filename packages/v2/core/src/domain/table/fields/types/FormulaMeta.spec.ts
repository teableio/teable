import { describe, expect, it } from 'vitest';

import { FormulaMeta } from './FormulaMeta';

describe('FormulaMeta', () => {
  it('rehydrates and exposes values', () => {
    const metaResult = FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true });
    expect(metaResult.isOk()).toBe(true);
    if (metaResult.isErr()) return;
    const meta = metaResult.value;
    expect(meta.isRehydrated()).toBe(true);

    const value = meta.value();
    expect(value.isOk()).toBe(true);
    if (value.isErr()) return;
    expect(value.value.persistedAsGeneratedColumn).toBe(true);

    const persisted = meta.persistedAsGeneratedColumn();
    expect(persisted.isOk()).toBe(true);
    if (persisted.isErr()) return;
    expect(persisted.value).toBe(true);

    const dto = meta.toDto();
    expect(dto.isOk()).toBe(true);
    if (dto.isErr()) return;
    expect(dto.value.persistedAsGeneratedColumn).toBe(true);
  });

  it('rejects invalid meta and unhydrated access', () => {
    const invalid = FormulaMeta.rehydrate('bad');
    expect(invalid.isErr()).toBe(true);

    const empty = FormulaMeta.empty();
    expect(empty.isRehydrated()).toBe(false);
    const value = empty.value();
    expect(value.isErr()).toBe(true);
  });
});
