import { describe, expect, it } from 'vitest';

import { FormulaMeta } from './FormulaMeta';

describe('FormulaMeta', () => {
  it('rehydrates and exposes values', () => {
    const metaResult = FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true });
    metaResult._unsafeUnwrap();

    const meta = metaResult._unsafeUnwrap();
    expect(meta.isRehydrated()).toBe(true);

    const value = meta.value();
    const metaValue = value._unsafeUnwrap();
    expect(metaValue.persistedAsGeneratedColumn).toBe(true);

    const persisted = meta.persistedAsGeneratedColumn();
    expect(persisted._unsafeUnwrap()).toBe(true);

    const dto = meta.toDto();
    const dtoValue = dto._unsafeUnwrap();
    expect(dtoValue.persistedAsGeneratedColumn).toBe(true);
  });

  it('rejects invalid meta and unhydrated access', () => {
    const invalid = FormulaMeta.rehydrate('bad');
    invalid._unsafeUnwrapErr();

    const empty = FormulaMeta.empty();
    expect(empty.isRehydrated()).toBe(false);
    const value = empty.value();
    value._unsafeUnwrapErr();
  });
});
