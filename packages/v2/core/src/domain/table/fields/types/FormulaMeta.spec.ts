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

  it('preserves supported and future policy versions across serialized metadata', () => {
    for (const formulaSafetyVersion of [1, 2]) {
      const meta = FormulaMeta.rehydrate({
        persistedAsGeneratedColumn: true,
        formulaSafetyVersion,
      })._unsafeUnwrap();
      const restored = FormulaMeta.rehydrate(
        JSON.parse(JSON.stringify(meta.toDto()._unsafeUnwrap()))
      )._unsafeUnwrap();
      expect(restored.formulaSafetyVersion()._unsafeUnwrap()).toBe(formulaSafetyVersion);
      expect(restored.persistedAsGeneratedColumn()._unsafeUnwrap()).toBe(true);
    }
  });

  it('rejects invalid policy versions instead of silently making them legacy', () => {
    for (const formulaSafetyVersion of [0, -1, 1.5, '1', null]) {
      expect(FormulaMeta.rehydrate({ formulaSafetyVersion }).isErr()).toBe(true);
    }
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
