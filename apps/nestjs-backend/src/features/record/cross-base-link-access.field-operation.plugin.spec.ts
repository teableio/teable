import { HttpErrorCode, Relationship } from '@teable/core';
import {
  createLinkField,
  FieldId,
  FieldName,
  FieldOperationKind,
  FieldOperationTargetKind,
  LinkFieldConfig,
  type FieldOperationPluginContext,
} from '@teable/v2-core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import { CrossBaseLinkAccessFieldOperationPlugin } from './cross-base-link-access.field-operation.plugin';

type ForeignTableCheckMock = Mock<(tableId: string, foreignTableId: string) => Promise<void>>;

const HOST_TABLE_ID = `tbl${'h'.repeat(16)}`;
const PREVIOUS_FOREIGN_TABLE_ID = `tbl${'a'.repeat(16)}`;
const NEW_FOREIGN_TABLE_ID = `tbl${'b'.repeat(16)}`;
const HOST_LINK_FIELD_ID = `fld${'l'.repeat(16)}`;
const LOOKUP_FIELD_ID = `fld${'p'.repeat(16)}`;

const foreignTable = (id: string) => ({ id: () => ({ toString: () => id }) });

const createLinkFieldEntity = (foreignTableId: string) =>
  FieldId.create(HOST_LINK_FIELD_ID)
    .andThen((id) =>
      FieldName.create('link').andThen((name) =>
        LinkFieldConfig.create({
          relationship: Relationship.ManyMany,
          foreignTableId,
          lookupFieldId: LOOKUP_FIELD_ID,
        }).andThen((config) => createLinkField({ id, name, config }))
      )
    )
    ._unsafeUnwrap();

const createPlugin = () => {
  const assertNewForeignTableAllowed: ForeignTableCheckMock = vi.fn().mockResolvedValue(undefined);
  const plugin = new CrossBaseLinkAccessFieldOperationPlugin({
    assertNewForeignTableAllowed,
  } as never);
  return { plugin, assertNewForeignTableAllowed };
};

const createCreateContext = (foreignTableIds: ReadonlyArray<string>) =>
  ({
    kind: FieldOperationKind.create,
    executionContext: {} as never,
    table: foreignTable(HOST_TABLE_ID) as never,
    target: {
      kind: FieldOperationTargetKind.direct,
      sourceOperation: FieldOperationKind.create,
      sourceTable: foreignTable(HOST_TABLE_ID),
    },
    payload: {
      foreignTables: foreignTableIds.map(foreignTable) as never,
    },
    isTransactionBound: false,
  }) as unknown as FieldOperationPluginContext;

const createUpdateContext = (
  previousForeignTableId: string,
  foreignTableIds: ReadonlyArray<string>
) =>
  ({
    kind: FieldOperationKind.update,
    executionContext: {} as never,
    table: foreignTable(HOST_TABLE_ID) as never,
    target: {
      kind: FieldOperationTargetKind.direct,
      sourceOperation: FieldOperationKind.update,
      sourceTable: foreignTable(HOST_TABLE_ID),
    },
    payload: {
      fieldId: { toString: () => HOST_LINK_FIELD_ID },
      fieldUpdate: {},
      previousField: createLinkFieldEntity(previousForeignTableId),
      updateSpecs: [],
      foreignTables: foreignTableIds.map(foreignTable) as never,
      allowNoop: false,
    },
    isTransactionBound: false,
  }) as unknown as FieldOperationPluginContext;

const calls = (mock: ForeignTableCheckMock): string[][] =>
  mock.mock.calls.map(([tableId, foreignTableId]) => [tableId, foreignTableId]);

describe('CrossBaseLinkAccessFieldOperationPlugin', () => {
  it('applies to field creation and update only', () => {
    const { plugin } = createPlugin();

    expect(plugin.supports(FieldOperationKind.create)).toBe(true);
    expect(plugin.supports(FieldOperationKind.update)).toBe(true);
    expect(plugin.supports(FieldOperationKind.delete)).toBe(false);
    expect(plugin.supports(FieldOperationKind.duplicate)).toBe(false);
  });

  it('requires a readable, same-space target for every reference a new field adds', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();

    const result = await plugin.prepare(createCreateContext([NEW_FOREIGN_TABLE_ID]));

    expect(result.isOk()).toBe(true);
    expect(calls(assertNewForeignTableAllowed)).toEqual([[HOST_TABLE_ID, NEW_FOREIGN_TABLE_ID]]);
  });

  it('checks only the newly referenced table when an update keeps an old reference', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();

    const result = await plugin.prepare(
      createUpdateContext(PREVIOUS_FOREIGN_TABLE_ID, [
        PREVIOUS_FOREIGN_TABLE_ID,
        NEW_FOREIGN_TABLE_ID,
      ])
    );

    expect(result.isOk()).toBe(true);
    expect(calls(assertNewForeignTableAllowed)).toEqual([[HOST_TABLE_ID, NEW_FOREIGN_TABLE_ID]]);
  });

  it('keeps the read check off an existing reference the update does not change', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();

    const result = await plugin.prepare(
      createUpdateContext(PREVIOUS_FOREIGN_TABLE_ID, [PREVIOUS_FOREIGN_TABLE_ID])
    );

    expect(result.isOk()).toBe(true);
    expect(assertNewForeignTableAllowed).not.toHaveBeenCalled();
  });

  it('does not re-check a reference the update drops', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();

    const result = await plugin.prepare(createUpdateContext(PREVIOUS_FOREIGN_TABLE_ID, []));

    expect(result.isOk()).toBe(true);
    expect(assertNewForeignTableAllowed).not.toHaveBeenCalled();
  });

  it('leaves side-effect fields to the direct field that produced them', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();
    const context = createCreateContext([NEW_FOREIGN_TABLE_ID]);
    const sideEffectContext = {
      ...context,
      target: {
        kind: FieldOperationTargetKind.sideEffect,
        sourceOperation: FieldOperationKind.create,
        sourceTable: foreignTable(HOST_TABLE_ID),
      },
    } as unknown as FieldOperationPluginContext;

    const result = await plugin.prepare(sideEffectContext);

    expect(result.isOk()).toBe(true);
    expect(assertNewForeignTableAllowed).not.toHaveBeenCalled();
  });

  it('returns a forbidden domain error when the target is readable nowhere', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();
    assertNewForeignTableAllowed.mockRejectedValue(
      new CustomHttpException(
        `not allowed to operate record|read on ${NEW_FOREIGN_TABLE_ID}`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        { localization: { i18nKey: 'httpErrors.permission.notAllowedOperation' } }
      )
    );

    const result = await plugin.prepare(createCreateContext([NEW_FOREIGN_TABLE_ID]));

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('cross_base_link.foreign_table_read_forbidden');
    expect(error.tags).toContain('forbidden');
    expect(error.details).toEqual({
      operation: FieldOperationKind.create,
      tableId: HOST_TABLE_ID,
    });
  });

  it('keeps a cross-space rejection a validation error with its context', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();
    assertNewForeignTableAllowed.mockRejectedValue(
      new CustomHttpException(
        `Cross-space link is no longer supported (foreignTableId: ${NEW_FOREIGN_TABLE_ID})`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.crossSpaceLinkForbidden',
            context: { foreignTableId: NEW_FOREIGN_TABLE_ID },
          },
        }
      )
    );

    const result = await plugin.prepare(createCreateContext([NEW_FOREIGN_TABLE_ID]));

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('cross_base_link.cross_space_target_forbidden');
    expect(error.tags).toContain('validation');
    expect(error.localization).toEqual({
      i18nKey: 'httpErrors.field.crossSpaceLinkForbidden',
      context: { foreignTableId: NEW_FOREIGN_TABLE_ID },
    });
  });

  it('rethrows a failure the link check does not own', async () => {
    const { plugin, assertNewForeignTableAllowed } = createPlugin();
    const failure = new Error('connection reset');
    assertNewForeignTableAllowed.mockRejectedValue(failure);

    await expect(plugin.prepare(createCreateContext([NEW_FOREIGN_TABLE_ID]))).rejects.toBe(failure);
  });
});
