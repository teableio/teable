import {
  DeleteFieldCommand,
  domainError,
  type DomainError,
  type FieldDeletionPreparation,
  type FieldDeletionPreparationService,
  type IExecutionContext,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  FieldDeletePreviewPlanner,
  type IFieldDeletePreviewAuthorization,
} from './FieldDeletePreviewPlanner';
import type { PreviewOptions } from './types';

const context = {} as IExecutionContext;
const options: PreviewOptions = { detail: 'full', includeComplexity: false, maxItems: 100 };
const command = DeleteFieldCommand.create({
  baseId: `bse${'a'.repeat(16)}`,
  tableId: `tbl${'b'.repeat(16)}`,
  fieldId: `fld${'c'.repeat(16)}`,
})._unsafeUnwrap();

const preparation = (overrides: Partial<FieldDeletionPreparation> = {}): FieldDeletionPreparation =>
  ({
    table: {} as never,
    projectedTable: {} as never,
    targetFields: [],
    foreignTables: [],
    directTargets: [
      {
        kind: 'direct',
        tableId: command.tableId.toString(),
        tableName: 'Orders',
        fieldId: command.fieldId.toString(),
        fieldName: 'Customer',
      },
    ],
    symmetricTargets: [],
    snapshotFields: [],
    dependentFields: [],
    views: [],
    missingMetadata: [],
    sideEffects: { sideEffects: [] },
    cleanup: [],
    tablesBeforeDeletionById: new Map(),
    ...overrides,
  }) as FieldDeletionPreparation;

const plannerWith = (
  result: Result<FieldDeletionPreparation, DomainError>,
  authorization?: IFieldDeletePreviewAuthorization
) => {
  const prepare = vi.fn(async () => result);
  return {
    planner: new FieldDeletePreviewPlanner(
      { prepare } as unknown as FieldDeletionPreparationService,
      authorization
    ),
    prepare,
  };
};

describe('FieldDeletePreviewPlanner', () => {
  it('normalizes direct, dependent, view, and symmetric effects without executable plans', async () => {
    const authorization: IFieldDeletePreviewAuthorization = {
      canReadResource: vi.fn(async () => ok(true)),
    };
    const { planner, prepare } = plannerWith(
      ok(
        preparation({
          symmetricTargets: [
            {
              kind: 'symmetric',
              tableId: `tbl${'d'.repeat(16)}`,
              tableName: 'Customers',
              fieldId: `fld${'e'.repeat(16)}`,
              fieldName: 'Orders',
            },
          ],
          dependentFields: [
            {
              tableId: command.tableId.toString(),
              tableName: 'Orders',
              fieldId: `fld${'f'.repeat(16)}`,
              fieldName: 'Customer name',
              deletedFieldId: command.fieldId.toString(),
            },
          ],
          views: [
            {
              tableId: command.tableId.toString(),
              tableName: 'Orders',
              viewId: `viw${'g'.repeat(16)}`,
              viewName: 'Open orders',
              deletedFieldId: command.fieldId.toString(),
              changes: ['queryDefaults'],
            },
          ],
        })
      ),
      authorization
    );

    const result = await planner.preview(context, command, options);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().effects.map((effect) => effect.code)).toEqual([
      'field.delete.target',
      'field.delete.symmetric_link_removed',
      'field.delete.dependent_field_changed',
      'field.delete.view_changed',
    ]);
    expect(result._unsafeUnwrap().effects[1]?.measures.fields).toEqual({
      basis: 'exact',
      value: 1,
      unit: 'field',
    });
    expect(result._unsafeUnwrap().effects[0]?.resource).toEqual(
      expect.objectContaining({
        visibility: 'authorized',
        id: command.fieldId.toString(),
      })
    );
    expect(result._unsafeUnwrap().authorization).toBe('checked');
    expect(result._unsafeUnwrap().complexityProjection).toMatchObject({
      tableId: command.tableId.toString(),
      operation: {
        kind: 'field-change',
        tableId: command.tableId.toString(),
        changedFieldIds: [command.fieldId.toString()],
        fieldChange: 'delete',
      },
      coverage: {
        unknown: ['complexity-planner-projection', 'complexity-selection'],
      },
    });
    expect(JSON.stringify(result._unsafeUnwrap())).not.toContain('mutateSpec');
    expect(JSON.stringify(result._unsafeUnwrap())).not.toContain('spec');
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('keeps missing metadata explicit and never reports it as zero impact', async () => {
    const { planner } = plannerWith(
      ok(
        preparation({
          missingMetadata: [
            {
              kind: 'foreignTable',
              tableId: `tbl${'h'.repeat(16)}`,
              referencedByFieldId: command.fieldId.toString(),
              reason: 'foreign-table-not-loaded',
            },
          ],
        })
      )
    );

    const plan = (await planner.preview(context, command, options))._unsafeUnwrap();

    expect(plan.warnings).toEqual([
      expect.objectContaining({ code: 'field.delete.foreign_metadata_missing' }),
    ]);
    expect(plan.effects[0]?.resource).toEqual(
      expect.objectContaining({
        visibility: 'redacted',
        quantity: expect.objectContaining({ basis: 'unknown' }),
      })
    );
    expect(plan.effects[0]?.measures.fields).toEqual(expect.objectContaining({ basis: 'unknown' }));
    expect(plan.coverage.unknown).toContain(
      'cross-table effects for missing foreign table metadata'
    );
    expect(JSON.stringify(plan)).not.toContain('"value":0');
  });

  it.each([2, 7, 37])(
    'redacts %i hidden dependents while preserving authorized measures',
    async (hiddenCount) => {
      const visibleFieldId = `fld${'v'.repeat(16)}`;
      const hiddenFieldIds = Array.from(
        { length: hiddenCount },
        (_, index) => `fld${String(index).padStart(16, 'x')}`
      );
      const authorization: IFieldDeletePreviewAuthorization = {
        async canReadResource(_context, resource) {
          return ok(!hiddenFieldIds.includes(resource.id));
        },
      };
      const { planner } = plannerWith(
        ok(
          preparation({
            dependentFields: [
              {
                tableId: command.tableId.toString(),
                tableName: 'Orders',
                fieldId: visibleFieldId,
                fieldName: 'Visible dependent',
                deletedFieldId: command.fieldId.toString(),
              },
              ...hiddenFieldIds.map((fieldId, index) => ({
                tableId: command.tableId.toString(),
                tableName: `Hidden table ${index}`,
                fieldId,
                fieldName: `Hidden dependent ${index}`,
                deletedFieldId: command.fieldId.toString(),
              })),
            ],
          })
        ),
        authorization
      );

      const plan = (
        await planner.preview(context, command, { ...options, maxItems: 1 })
      )._unsafeUnwrap();
      const dependentEffects = plan.effects.filter(
        (effect) => effect.code === 'field.delete.dependent_field_changed'
      );
      const serialized = JSON.stringify(plan);

      expect(dependentEffects).toHaveLength(2);
      expect(dependentEffects[0]).toMatchObject({
        relatedResources: [{ visibility: 'authorized', id: visibleFieldId }],
        measures: { fields: { basis: 'exact', value: 1, unit: 'field' } },
      });
      expect(dependentEffects[1]).toMatchObject({
        relatedResources: [{ visibility: 'redacted' }],
        measures: { fields: { basis: 'unknown', unit: 'field' } },
      });
      expect(plan.coverage.unknown).toContain('redacted resource identities and cardinalities');
      expect(plan.warnings.map((warning) => warning.code)).not.toContain('preview.items_truncated');
      for (const hiddenFieldId of hiddenFieldIds) expect(serialized).not.toContain(hiddenFieldId);
      expect(serialized).not.toContain('Hidden dependent');
      expect(serialized).not.toContain('Hidden table');
      expect(serialized).not.toContain('"value":2');
      expect(serialized).not.toContain(`"value":${hiddenCount}`);
      expect(serialized).not.toContain(`of ${hiddenCount + 1}`);
    }
  );

  it('redacts forbidden authorization errors without exposing their message', async () => {
    const secret = `fld${'z'.repeat(16)}`;
    const authorization: IFieldDeletePreviewAuthorization = {
      canReadResource: vi.fn(async () =>
        err(
          domainError.forbidden({
            code: 'forbidden.preview.resource',
            message: `Cannot reveal ${secret} or 37 hidden dependents`,
          })
        )
      ),
    };
    const { planner } = plannerWith(ok(preparation()), authorization);

    const result = await planner.preview(context, command, options);
    const serialized = JSON.stringify(result._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('37 hidden dependents');
    expect(serialized).toContain('resource-authorization-denied');
  });

  it('propagates non-forbidden authorization failures instead of hiding them', async () => {
    const error = domainError.conflict({
      code: 'preview.authorization.unavailable',
      message: 'Permission evidence unavailable',
    });
    const { planner } = plannerWith(ok(preparation()), {
      async canReadResource() {
        return err(error);
      },
    });

    const result = await planner.preview(context, command, options);

    expect(result._unsafeUnwrapErr()).toBe(error);
  });

  it('normalizes detached aggregate invariants as field-operation blockers', async () => {
    const error = domainError.forbidden({
      code: 'forbidden.table.delete_primary_field',
      message: 'Cannot delete primary field',
    });
    const prepare = vi.fn(async () => err(error));
    const planner = new FieldDeletePreviewPlanner({
      prepare,
    } as unknown as FieldDeletionPreparationService);

    const plan = (await planner.preview(context, command, options))._unsafeUnwrap();

    expect(plan.blockers).toEqual([
      { code: 'forbidden.table.delete_primary_field', message: 'Cannot delete primary field' },
    ]);
    expect(plan.effects).toEqual([]);
  });
});
