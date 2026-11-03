import {
  ActorId,
  BaseId,
  DeleteTableCommand,
  domainError,
  FieldName,
  Table,
  TableName,
  type DomainError,
  type IExecutionContext,
  type ITableDeletionPreparationService,
  type TableDeletionPreparation,
} from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import {
  createTableDeletePreviewRegistration,
  type ITableDeletePreviewAuthorization,
  TableDeletePreviewPlanner,
} from './TableDeletePreviewPlanner';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const createTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Delete me')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class FakePreparationService implements ITableDeletionPreparationService {
  calls = 0;

  constructor(readonly value: TableDeletionPreparation) {}

  async prepare(): Promise<Result<TableDeletionPreparation, DomainError>> {
    this.calls += 1;
    return ok(this.value);
  }
}
const allowAuthorization: ITableDeletePreviewAuthorization = {
  async canReadResource() {
    return ok(true);
  },
};
class FailingPreparationService implements ITableDeletionPreparationService {
  async prepare(): Promise<Result<TableDeletionPreparation, DomainError>> {
    return err(
      domainError.conflict({ code: 'table.delete.link_blocked', message: 'Link blocks deletion.' })
    );
  }
}

const createPreparation = (
  overrides: Partial<TableDeletionPreparation> = {}
): TableDeletionPreparation => {
  const table = createTable();
  return {
    table,
    mode: 'soft',
    sourceState: 'active',
    blockers: [],
    sideEffects: {
      deletedTable: table,
      candidateEvidence: 'known',
      candidateTableCount: 1,
      downstreamCascadeEvidence: 'unknown',
      candidatePlans: [],
      reactionEffects: [
        {
          tableId: `tbl${'b'.repeat(16)}`,
          tableName: 'Orders',
          fieldId: `fld${'c'.repeat(16)}`,
          fieldName: 'Customer',
          previousType: 'link',
          nextType: 'singleLineText',
          consequence: 'inbound-link-converted-to-text',
        },
        {
          tableId: `tbl${'b'.repeat(16)}`,
          tableName: 'Orders',
          fieldId: `fld${'d'.repeat(16)}`,
          fieldName: 'Customer name',
          previousType: 'lookup',
          nextType: 'lookup',
          consequence: 'dependent-field-marked-error',
        },
      ],
    },
    ...overrides,
  };
};

const options = { detail: 'full' as const, includeComplexity: false, maxItems: 100 };

describe('TableDeletePreviewPlanner', () => {
  it('maps soft deletion plus ordered inbound link and dependent reactions', async () => {
    const service = new FakePreparationService(createPreparation());
    const planner = new TableDeletePreviewPlanner(service, allowAuthorization);
    const command = DeleteTableCommand.create({
      baseId: service.value.table.baseId().toString(),
      tableId: service.value.table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const plan = (await planner.preview(context, command, options))._unsafeUnwrap();

    expect(plan.effects.map((effect) => effect.code)).toEqual([
      'table.delete.resource.trashed',
      'table.delete.inbound_link.converted_to_text',
      'table.delete.dependent_field.marked_error',
    ]);
    expect(plan.effects[1]?.resource).toMatchObject({
      visibility: 'authorized',
      kind: 'field',
      name: 'Customer',
    });
    expect(plan.coverage.unknown).toEqual([
      'host.trash-retention',
      'host.usage-effects',
      'inbound-link-downstream-cascades',
    ]);
    expect(service.calls).toBe(1);
  });

  it('reports already-trashed permanent deletion, blockers, and unknown metadata without zeros', async () => {
    const table = createTable();
    const service = new FakePreparationService(
      createPreparation({
        table,
        mode: 'permanent',
        sourceState: 'trashed',
        blockers: [{ code: 'table.delete.blocked', message: 'Deletion is blocked.' }],
        sideEffects: {
          deletedTable: table,
          candidateEvidence: 'unknown',
          candidateTableCount: 0,
          downstreamCascadeEvidence: 'not-applicable',
          candidatePlans: [],
          reactionEffects: [],
        },
      })
    );
    const planner = new TableDeletePreviewPlanner(service, allowAuthorization);
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const plan = (await planner.preview(context, command, options))._unsafeUnwrap();

    expect(plan.effects[0]).toMatchObject({
      code: 'table.delete.resource.permanently_deleted',
      kind: 'resource.permanent-delete',
      measures: { tables: { basis: 'exact', value: 1, unit: 'table' } },
    });
    expect(plan.blockers).toEqual([
      { code: 'table.delete.blocked', message: 'Deletion is blocked.' },
    ]);
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'table.delete.already_trashed',
      'table.delete.inbound_reference_metadata_unknown',
    ]);
    expect(plan.coverage.unknown).toContain('inbound-reference-metadata');
    expect(JSON.stringify(plan)).not.toContain('"value":0');
  });

  it('redacts resource identities when authorization scope is unavailable', async () => {
    const service = new FakePreparationService(createPreparation());
    const planner = new TableDeletePreviewPlanner(service);
    const command = DeleteTableCommand.create({
      baseId: service.value.table.baseId().toString(),
      tableId: service.value.table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const plan = (await planner.preview(context, command, options))._unsafeUnwrap();

    expect(plan.authorization).toBe('not-applicable');
    expect(plan.coverage.unknown).toContain('dependent-resource-authorization');
    expect(plan.effects.every((effect) => effect.resource?.visibility === 'redacted')).toBe(true);
    expect(JSON.stringify(plan)).not.toContain(service.value.table.id().toString());
  });

  it.each([2, 7, 37])(
    'redacts %i hidden reactions while preserving authorized measures',
    async (hiddenCount) => {
      const source = createPreparation();
      const visibleReaction = source.sideEffects.reactionEffects[0]!;
      const hiddenFieldIds = Array.from(
        { length: hiddenCount },
        (_, index) => `fld${String(index).padStart(16, 'x')}`
      );
      const service = new FakePreparationService(
        createPreparation({
          sideEffects: {
            ...source.sideEffects,
            reactionEffects: [
              visibleReaction,
              ...hiddenFieldIds.map((fieldId, index) => ({
                tableId: `tbl${String(index).padStart(16, 'h')}`,
                tableName: `Hidden table ${index}`,
                fieldId,
                fieldName: `Hidden dependent ${index}`,
                previousType: index % 2 === 0 ? 'conditionalLookup' : 'conditionalRollup',
                nextType: index % 2 === 0 ? 'conditionalLookup' : 'conditionalRollup',
                consequence: 'dependent-field-marked-error' as const,
              })),
            ],
          },
        })
      );
      const authorization: ITableDeletePreviewAuthorization = {
        async canReadResource(_context, resource) {
          return ok(!hiddenFieldIds.includes(resource.id));
        },
      };
      const planner = new TableDeletePreviewPlanner(service, authorization);
      const command = DeleteTableCommand.create({
        baseId: service.value.table.baseId().toString(),
        tableId: service.value.table.id().toString(),
        mode: 'soft',
      })._unsafeUnwrap();

      const plan = (
        await planner.preview(context, command, { ...options, maxItems: 1 })
      )._unsafeUnwrap();
      const visibleEffect = plan.effects.find(
        (effect) => effect.code === 'table.delete.inbound_link.converted_to_text'
      );
      const hiddenEffects = plan.effects.filter(
        (effect) => effect.code === 'table.delete.dependent_resources.redacted'
      );
      const serialized = JSON.stringify(plan);

      expect(visibleEffect?.measures.fields).toEqual({ basis: 'exact', value: 1, unit: 'field' });
      expect(hiddenEffects).toHaveLength(1);
      expect(hiddenEffects[0]).toMatchObject({
        resource: { visibility: 'redacted' },
        measures: { fields: { basis: 'unknown', unit: 'field' } },
      });
      expect(plan.coverage.unknown).toContain('redacted-dependent-resource-cardinality');
      expect(plan.warnings.map((warning) => warning.code)).not.toContain(
        'table.delete.effects_truncated'
      );
      for (const hiddenFieldId of hiddenFieldIds) expect(serialized).not.toContain(hiddenFieldId);
      expect(serialized).not.toContain('Hidden dependent');
      expect(serialized).not.toContain('Hidden table');
      expect(serialized).not.toContain('"value":2');
      expect(serialized).not.toContain(`"value":${hiddenCount}`);
      expect(serialized).not.toContain(`of ${hiddenCount + 1}`);
    }
  );

  it.each([
    { deniedResource: 'field', detail: 'summary' as const },
    { deniedResource: 'field', detail: 'full' as const },
    { deniedResource: 'table', detail: 'summary' as const },
    { deniedResource: 'table', detail: 'full' as const },
  ])(
    'keeps $detail output invariant across hidden reaction kinds and counts when $deniedResource access is denied',
    async ({ deniedResource, detail }) => {
      const source = createPreparation();
      const visibleReaction = source.sideEffects.reactionEffects[0]!;
      const reactionKinds = [
        ...source.sideEffects.reactionEffects,
        {
          ...source.sideEffects.reactionEffects[1]!,
          consequence: 'dependent-field-updated' as const,
        },
      ];
      const command = DeleteTableCommand.create({
        baseId: source.table.baseId().toString(),
        tableId: source.table.id().toString(),
        mode: 'soft',
      })._unsafeUnwrap();
      const plans = [];
      for (const hiddenKinds of [
        [reactionKinds[0]!],
        [reactionKinds[1]!],
        [reactionKinds[2]!],
        reactionKinds,
        Array.from({ length: 37 }, (_, index) => reactionKinds[index % reactionKinds.length]!),
      ]) {
        const hiddenReactions = hiddenKinds.map((reaction, index) => ({
          ...reaction,
          tableId: `tbl${String(index).padStart(16, 'h')}`,
          tableName: `Hidden table ${index}`,
          fieldId: `fld${String(index).padStart(16, 'h')}`,
          fieldName: `Hidden field ${index}`,
        }));
        const hiddenIds = new Set(
          hiddenReactions.map((reaction) =>
            deniedResource === 'field' ? reaction.fieldId : reaction.tableId
          )
        );
        const planner = new TableDeletePreviewPlanner(
          new FakePreparationService({
            ...source,
            sideEffects: {
              ...source.sideEffects,
              candidateTableCount: hiddenReactions.length + 1,
              reactionEffects: [...hiddenReactions, visibleReaction],
            },
          }),
          {
            async canReadResource(_context, resource) {
              return ok(!hiddenIds.has(resource.id));
            },
          }
        );
        const plan = (
          await planner.preview(context, command, { ...options, detail, maxItems: 1 })
        )._unsafeUnwrap();
        expect(plan.effects).toHaveLength(3);
        expect(plan.effects[1]).toMatchObject({
          code: 'table.delete.inbound_link.converted_to_text',
          resource: { visibility: 'authorized', id: visibleReaction.fieldId },
          measures: { fields: { basis: 'exact', value: 1, unit: 'field' } },
        });
        expect(plan.effects[2]).toEqual({
          code: 'table.delete.dependent_resources.redacted',
          kind: 'dependency.change',
          summary: 'Dependent resource details are redacted.',
          resource: {
            visibility: 'redacted',
            kind: 'field',
            quantity: { basis: 'unknown', unit: 'field', reason: 'dependent-resource-redacted' },
            reason: 'dependent-resource-redacted',
          },
          measures: { fields: { basis: 'unknown', unit: 'field', reason: 'resource-redacted' } },
        });
        expect(JSON.stringify(plan)).not.toContain('Hidden');
        plans.push(plan);
      }
      for (const plan of plans.slice(1)) expect(plan).toEqual(plans[0]);
    }
  );

  it('redacts forbidden authorization errors without exposing their message', async () => {
    const secret = `fld${'z'.repeat(16)}`;
    const service = new FakePreparationService(createPreparation());
    const authorization: ITableDeletePreviewAuthorization = {
      async canReadResource() {
        return err(
          domainError.forbidden({
            code: 'forbidden.preview.resource',
            message: `Cannot reveal ${secret} or 41 hidden dependents`,
          })
        );
      },
    };
    const planner = new TableDeletePreviewPlanner(service, authorization);
    const command = DeleteTableCommand.create({
      baseId: service.value.table.baseId().toString(),
      tableId: service.value.table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const result = await planner.preview(context, command, options);
    const serialized = JSON.stringify(result._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('41 hidden dependents');
    expect(serialized).toContain('resource-authorization-denied');
  });

  it('normalizes domain conflicts into blockers', async () => {
    const planner = new TableDeletePreviewPlanner(
      new FailingPreparationService(),
      allowAuthorization
    );
    const table = createTable();
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const plan = (await planner.preview(context, command, options))._unsafeUnwrap();

    expect(plan.effects).toEqual([]);
    expect(plan.blockers).toEqual([
      { code: 'table.delete.link_blocked', message: 'Link blocks deletion.' },
    ]);
  });

  it('registers the exact write parser and partial host coverage', () => {
    const service = new FakePreparationService(createPreparation());
    const registration = createTableDeletePreviewRegistration(
      new TableDeletePreviewPlanner(service)
    );

    expect(
      registration
        .parseInput({
          baseId: service.value.table.baseId().toString(),
          tableId: service.value.table.id().toString(),
          mode: 'permanent',
        })
        .isOk()
    ).toBe(true);
    expect(registration.capability).toMatchObject({
      supportLevel: 'partial',
      requiredPermissionScope: 'table.delete',
    });
  });
});
