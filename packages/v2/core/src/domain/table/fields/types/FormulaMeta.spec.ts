import { describe, expect, it } from 'vitest';

import { FormulaMeta } from './FormulaMeta';

describe('FormulaMeta', () => {
  it('rehydrates and exposes values', () => {
    const metaResult = FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true });
    metaResult._unsafeUnwrap();

    const meta = metaResult._unsafeUnwrap();
    expect(meta.isRehydrated()).toBe(true);

    const value = meta.value();
    value._unsafeUnwrap();

    expect(value.value.persistedAsGeneratedColumn).toBe(true);

    const persisted = meta.persistedAsGeneratedColumn();
    persisted._unsafeUnwrap();

    expect(persisted.value).toBe(true);

    const dto = meta.toDto();
    dto._unsafeUnwrap();

    expect(dto.value.persistedAsGeneratedColumn).toBe(true);
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
