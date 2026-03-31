import { BaseId, domainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  createMetaValidationContext,
  createMetaValidationContextFromTables,
} from './MetaValidationContext';

const asId = (value: string) => ({
  toString: () => value,
});

const createField = (params: {
  id: string;
  name?: string;
  type?: string;
  foreignTableId?: string;
  linkFieldId?: string;
  baseId?: ReturnType<typeof BaseId.create> extends { _unsafeUnwrap(): infer T } ? T : never;
}) => ({
  id: () => asId(params.id),
  name: () => asId(params.name ?? params.id),
  type: () => asId(params.type ?? 'singleLineText'),
  ...(params.foreignTableId
    ? {
        foreignTableId: () => asId(params.foreignTableId),
      }
    : {}),
  ...(params.linkFieldId
    ? {
        linkFieldId: () => asId(params.linkFieldId),
      }
    : {}),
  ...(params.baseId
    ? {
        baseId: () => params.baseId,
      }
    : {}),
});

const createTable = (params: {
  id: string;
  name?: string;
  fields?: ReturnType<typeof createField>[];
}) => {
  const fields = params.fields ?? [];
  return {
    id: () => asId(params.id),
    name: () => asId(params.name ?? params.id),
    getFields: (predicate?: (field: ReturnType<typeof createField>) => boolean) =>
      predicate ? fields.filter(predicate) : fields,
  };
};

describe('MetaValidationContext', () => {
  it('loads missing referenced tables from the current base and exposes lookup helpers', async () => {
    const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
    const targetField = createField({
      id: `fld${'1'.repeat(16)}`,
      type: 'link',
      foreignTableId: `tbl${'2'.repeat(16)}`,
    });
    const targetTable = createTable({
      id: `tbl${'0'.repeat(16)}`,
      name: 'Projects',
      fields: [targetField],
    });
    const foreignField = createField({
      id: `fld${'3'.repeat(16)}`,
      name: 'Name',
    });
    const foreignTable = createTable({
      id: `tbl${'2'.repeat(16)}`,
      name: 'Tasks',
      fields: [foreignField],
    });
    const tableRepository = {
      find: vi
        .fn()
        .mockResolvedValueOnce(ok([]))
        .mockResolvedValueOnce(ok([foreignTable])),
    };

    const result = await createMetaValidationContext(
      baseId,
      targetTable as never,
      tableRepository as never,
      {} as never
    );

    const ctx = result._unsafeUnwrap();
    expect(tableRepository.find).toHaveBeenCalledTimes(2);
    expect(ctx.hasTable(targetTable.id().toString())).toBe(true);
    expect(ctx.hasTable(foreignTable.id().toString())).toBe(true);
    expect(ctx.getTable(foreignTable.id().toString())).toBe(foreignTable);
    expect(ctx.getField(foreignTable.id().toString(), foreignField.id().toString())).toBe(
      foreignField
    );
  });

  it('loads cross-base referenced tables when the link field carries a foreign base id', async () => {
    const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const foreignBaseId = BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap();
    const targetTable = createTable({
      id: `tbl${'4'.repeat(16)}`,
      fields: [
        createField({
          id: `fld${'5'.repeat(16)}`,
          type: 'link',
          foreignTableId: `tbl${'6'.repeat(16)}`,
          baseId: foreignBaseId,
        }),
      ],
    });
    const foreignTable = createTable({
      id: `tbl${'6'.repeat(16)}`,
      fields: [createField({ id: `fld${'7'.repeat(16)}`, name: 'Remote Name' })],
    });
    const tableRepository = {
      find: vi
        .fn()
        .mockResolvedValueOnce(ok([targetTable]))
        .mockResolvedValueOnce(ok([foreignTable])),
    };

    const result = await createMetaValidationContext(
      baseId,
      targetTable as never,
      tableRepository as never,
      {} as never
    );

    expect(result._unsafeUnwrap().hasTable(foreignTable.id().toString())).toBe(true);
    expect(tableRepository.find).toHaveBeenCalledTimes(2);
  });

  it('returns repository and unexpected failures as domain errors', async () => {
    const baseId = BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap();
    const table = createTable({ id: `tbl${'8'.repeat(16)}` });
    const repositoryError = domainError.infrastructure({ message: 'load failed' });
    const errorRepo = {
      find: vi.fn().mockResolvedValue(err(repositoryError)),
    };
    const throwingRepo = {
      find: vi.fn().mockRejectedValue(new Error('boom')),
    };

    const repoErrorResult = await createMetaValidationContext(
      baseId,
      table as never,
      errorRepo as never,
      {} as never
    );
    const thrownErrorResult = await createMetaValidationContext(
      baseId,
      table as never,
      throwingRepo as never,
      {} as never
    );

    expect(repoErrorResult._unsafeUnwrapErr()).toBe(repositoryError);
    expect(thrownErrorResult._unsafeUnwrapErr()).toMatchObject({
      tags: ['infrastructure'],
      message: 'Failed to create meta validation context: Error: boom',
    });
  });

  it('creates an in-memory context from preloaded tables', () => {
    const baseId = BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap();
    const field = createField({ id: `fld${'9'.repeat(16)}`, name: 'Title' });
    const table = createTable({
      id: `tbl${'a'.repeat(16)}`,
      name: 'Stories',
      fields: [field],
    });

    const ctx = createMetaValidationContextFromTables(baseId, table as never, []);

    expect(ctx.baseId).toBe(baseId);
    expect(ctx.table).toBe(table);
    expect(ctx.hasTable(table.id().toString())).toBe(true);
    expect(ctx.hasField(table.id().toString(), field.id().toString())).toBe(true);
  });
});
