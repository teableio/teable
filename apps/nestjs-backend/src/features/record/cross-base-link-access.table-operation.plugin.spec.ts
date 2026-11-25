import { HttpErrorCode, Relationship } from '@teable/core';
import {
  createLinkField,
  FieldId,
  FieldName,
  LinkFieldConfig,
  TableOperationCreateManySource,
  TableOperationKind,
  type TableOperationPluginContext,
} from '@teable/v2-core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { CROSS_BASE_LINK_FOREIGN_TABLE_READ_FORBIDDEN } from './cross-base-link-access.service';
import { CrossBaseLinkAccessTableOperationPlugin } from './cross-base-link-access.table-operation.plugin';

type AdmissionMock = Mock<(baseId: string, foreignTableIds: Iterable<string>) => Promise<void>>;

const BASE_ID = `bse${'h'.repeat(16)}`;
const NEW_TABLE_ID = `tbl${'n'.repeat(16)}`;
const SIBLING_TABLE_ID = `tbl${'s'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'f'.repeat(16)}`;
const LOOKUP_FIELD_ID = `fld${'p'.repeat(16)}`;

let fieldSeq = 0;
const linkTo = (foreignTableId: string) =>
  FieldId.create(`fld${String(++fieldSeq).padStart(16, 'l')}`)
    .andThen((id) =>
      FieldName.create(`link ${fieldSeq}`).andThen((name) =>
        LinkFieldConfig.create({
          relationship: Relationship.ManyMany,
          foreignTableId,
          lookupFieldId: LOOKUP_FIELD_ID,
        }).andThen((config) => createLinkField({ id, name, config }))
      )
    )
    ._unsafeUnwrap();

const table = (id: string, fields: ReadonlyArray<unknown>) => ({
  id: () => ({ toString: () => id }),
  getFields: () => fields,
});

const baseId = { toString: () => BASE_ID };

const createContext = (tables: ReadonlyArray<ReturnType<typeof table>>) =>
  ({
    kind: TableOperationKind.create,
    executionContext: {} as never,
    payload: { baseId, table: tables[0] },
    isTransactionBound: false,
  }) as unknown as TableOperationPluginContext;

const createManyContext = (
  source: TableOperationCreateManySource,
  tables: ReadonlyArray<ReturnType<typeof table>>
) =>
  ({
    kind: TableOperationKind.createMany,
    executionContext: {} as never,
    payload: { baseId, source, tables: tables.map((value) => ({ baseId, table: value })) },
    isTransactionBound: false,
  }) as unknown as TableOperationPluginContext;

const createPlugin = (admission?: AdmissionMock) => {
  const assertNewForeignTablesAllowedInBase: AdmissionMock =
    admission ?? vi.fn().mockResolvedValue(undefined);
  const plugin = new CrossBaseLinkAccessTableOperationPlugin({
    assertNewForeignTablesAllowedInBase,
  } as never);
  return { plugin, assertNewForeignTablesAllowedInBase };
};

describe('CrossBaseLinkAccessTableOperationPlugin', () => {
  it('runs for table creation only', () => {
    const { plugin } = createPlugin();

    expect(plugin.supports(TableOperationKind.create)).toBe(true);
    expect(plugin.supports(TableOperationKind.createMany)).toBe(true);
    expect(plugin.supports(TableOperationKind.duplicate)).toBe(false);
    expect(plugin.supports(TableOperationKind.importCsv)).toBe(false);
  });

  it('admits the foreign tables the new table references, in the base it is created in', async () => {
    const { plugin, assertNewForeignTablesAllowedInBase } = createPlugin();

    const result = await plugin.prepare(
      createContext([table(NEW_TABLE_ID, [linkTo(FOREIGN_TABLE_ID)])])
    );

    expect(result.isOk()).toBe(true);
    expect(assertNewForeignTablesAllowedInBase).toHaveBeenCalledWith(
      BASE_ID,
      new Set([FOREIGN_TABLE_ID])
    );
  });

  it('does not treat a self link as foreign', async () => {
    const { plugin, assertNewForeignTablesAllowedInBase } = createPlugin();

    await plugin.prepare(createContext([table(NEW_TABLE_ID, [linkTo(NEW_TABLE_ID)])]));

    expect(assertNewForeignTablesAllowedInBase).not.toHaveBeenCalled();
  });

  it('checks createTables, leaving the tables created together out', async () => {
    const { plugin, assertNewForeignTablesAllowedInBase } = createPlugin();

    await plugin.prepare(
      createManyContext(TableOperationCreateManySource.createTables, [
        table(NEW_TABLE_ID, [linkTo(SIBLING_TABLE_ID), linkTo(FOREIGN_TABLE_ID)]),
        table(SIBLING_TABLE_ID, [linkTo(NEW_TABLE_ID)]),
      ])
    );

    expect(assertNewForeignTablesAllowedInBase).toHaveBeenCalledWith(
      BASE_ID,
      new Set([FOREIGN_TABLE_ID])
    );
  });

  it.each([
    TableOperationCreateManySource.duplicateBase,
    TableOperationCreateManySource.importDotTea,
  ])('leaves the references a %s copies as they were', async (source) => {
    const { plugin, assertNewForeignTablesAllowedInBase } = createPlugin();

    const result = await plugin.prepare(
      createManyContext(source, [table(NEW_TABLE_ID, [linkTo(FOREIGN_TABLE_ID)])])
    );

    expect(result.isOk()).toBe(true);
    expect(assertNewForeignTablesAllowedInBase).not.toHaveBeenCalled();
  });

  it('returns a forbidden domain error when the caller cannot read the foreign table', async () => {
    const { plugin } = createPlugin(
      vi
        .fn()
        .mockRejectedValue(
          new CustomHttpException('no permission', HttpErrorCode.RESTRICTED_RESOURCE)
        )
    );

    const result = await plugin.prepare(
      createContext([table(NEW_TABLE_ID, [linkTo(FOREIGN_TABLE_ID)])])
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: CROSS_BASE_LINK_FOREIGN_TABLE_READ_FORBIDDEN,
      tags: expect.arrayContaining(['forbidden']),
      details: { operation: TableOperationKind.create, baseId: BASE_ID },
    });
  });

  it('returns a validation error for a table in another space', async () => {
    const { plugin } = createPlugin(
      vi
        .fn()
        .mockRejectedValue(
          new CustomHttpException('Cross-space link', HttpErrorCode.VALIDATION_ERROR)
        )
    );

    const result = await plugin.prepare(
      createContext([table(NEW_TABLE_ID, [linkTo(FOREIGN_TABLE_ID)])])
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'cross_base_link.cross_space_target_forbidden',
    });
  });

  it('lets other failures through', async () => {
    const failure = new Error('database down');
    const { plugin } = createPlugin(vi.fn().mockRejectedValue(failure));

    await expect(
      plugin.prepare(createContext([table(NEW_TABLE_ID, [linkTo(FOREIGN_TABLE_ID)])]))
    ).rejects.toBe(failure);
  });
});
