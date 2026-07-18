import { createBaseOkResponseSchema } from '@teable/v2-contract-http';
import {
  BaseId,
  FieldId,
  getRandomString,
  RecordId,
  TableId,
  v2CoreTokens,
  type IHasher,
} from '@teable/v2-core';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildOutboxTaskInput,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdatePlan,
  type IComputedUpdateOutbox,
} from '../../adapter-table-repository-postgres/src';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const createFieldId = () => `fld${getRandomString(16)}`;

const unwrapDomainId = <T>(result: {
  isErr(): boolean;
  error?: { message: string };
  value: T;
}): T => {
  if (result.isErr()) {
    throw new Error(result.error?.message ?? 'Invalid domain id');
  }
  return result.value;
};

describe('anonymized nested numeric lookup IF computation (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('computes and refreshes the deepest available category code', async () => {
    const createCategoryTier = async (label: string, code: number) => {
      const nameFieldId = createFieldId();
      const codeFieldId = createFieldId();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `${label} Reference ${getRandomString(6)}`,
        fields: [
          {
            type: 'singleLineText',
            id: nameFieldId,
            name: 'Category Name',
            isPrimary: true,
          },
          { type: 'number', id: codeFieldId, name: 'Category Code' },
        ],
        views: [{ type: 'grid' }],
      });
      const record = await ctx.createRecord(table.id, {
        [nameFieldId]: label,
        [codeFieldId]: code,
      });
      return { table, record, nameFieldId, codeFieldId };
    };

    const tierOne = await createCategoryTier('Tier One', 101);
    const tierTwo = await createCategoryTier('Tier Two', 202);
    const tierThree = await createCategoryTier('Tier Three', 303);
    const tierTwoUpdated = await ctx.createRecord(tierTwo.table.id, {
      [tierTwo.nameFieldId]: 'Tier Two Updated',
      [tierTwo.codeFieldId]: 212,
    });

    const tierThreeParentLinkFieldId = createFieldId();
    const tierThreeParentNameFieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tierThree.table.id,
      field: {
        type: 'link',
        id: tierThreeParentLinkFieldId,
        name: 'Parent Category',
        options: {
          relationship: 'manyOne',
          foreignTableId: tierTwo.table.id,
          lookupFieldId: tierTwo.nameFieldId,
        },
      },
    });
    await ctx.createField({
      baseId: ctx.baseId,
      tableId: tierThree.table.id,
      field: {
        type: 'lookup',
        id: tierThreeParentNameFieldId,
        name: 'Parent Category Name',
        options: {
          linkFieldId: tierThreeParentLinkFieldId,
          foreignTableId: tierTwo.table.id,
          lookupFieldId: tierTwo.nameFieldId,
        },
      },
    });
    await ctx.updateRecord(tierThree.table.id, tierThree.record.id, {
      [tierThreeParentLinkFieldId]: { id: tierTwo.record.id },
    });
    await ctx.drainOutbox();

    const createBaseResponse = await fetch(`${ctx.baseUrl}/bases/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Category Summary Base ${getRandomString(6)}`,
        spaceId: 'space_test',
      }),
    });
    const createBaseBody = await createBaseResponse.json();
    const parsedBase = createBaseOkResponseSchema.safeParse(createBaseBody);
    if (createBaseResponse.status !== 201 || !parsedBase.success || !parsedBase.data.ok) {
      throw new Error(`Failed to create target base: ${JSON.stringify(createBaseBody)}`);
    }
    const targetBaseId = parsedBase.data.data.base.id;

    const assignmentNameFieldId = createFieldId();
    const tierOneLinkFieldId = createFieldId();
    const tierOneCodeFieldId = createFieldId();
    const tierTwoLinkFieldId = createFieldId();
    const tierTwoCodeFieldId = createFieldId();
    const tierThreeLinkFieldId = createFieldId();
    const tierThreeCodeFieldId = createFieldId();
    const tierThreeParentLookupFieldId = createFieldId();
    const effectiveCodeFieldId = createFieldId();
    const assignmentTable = await ctx.createTable({
      baseId: targetBaseId,
      name: `Category Assignment ${getRandomString(6)}`,
      fields: [
        {
          type: 'singleLineText',
          id: assignmentNameFieldId,
          name: 'Assignment',
          isPrimary: true,
        },
        {
          type: 'link',
          id: tierOneLinkFieldId,
          name: 'Tier One Category',
          options: {
            baseId: ctx.baseId,
            relationship: 'oneOne',
            isOneWay: true,
            foreignTableId: tierOne.table.id,
            lookupFieldId: tierOne.nameFieldId,
          },
        },
        {
          type: 'lookup',
          id: tierOneCodeFieldId,
          name: 'Tier One Code',
          options: {
            linkFieldId: tierOneLinkFieldId,
            foreignTableId: tierOne.table.id,
            lookupFieldId: tierOne.codeFieldId,
          },
        },
        {
          type: 'link',
          id: tierTwoLinkFieldId,
          name: 'Tier Two Category',
          options: {
            baseId: ctx.baseId,
            relationship: 'oneOne',
            isOneWay: true,
            foreignTableId: tierTwo.table.id,
            lookupFieldId: tierTwo.nameFieldId,
          },
        },
        {
          type: 'lookup',
          id: tierTwoCodeFieldId,
          name: 'Tier Two Code',
          options: {
            linkFieldId: tierTwoLinkFieldId,
            foreignTableId: tierTwo.table.id,
            lookupFieldId: tierTwo.codeFieldId,
          },
        },
        {
          type: 'link',
          id: tierThreeLinkFieldId,
          name: 'Tier Three Category',
          options: {
            baseId: ctx.baseId,
            relationship: 'oneOne',
            isOneWay: true,
            foreignTableId: tierThree.table.id,
            lookupFieldId: tierThree.nameFieldId,
          },
        },
        {
          type: 'lookup',
          id: tierThreeCodeFieldId,
          name: 'Tier Three Code',
          options: {
            linkFieldId: tierThreeLinkFieldId,
            foreignTableId: tierThree.table.id,
            lookupFieldId: tierThree.codeFieldId,
          },
        },
        {
          type: 'lookup',
          id: tierThreeParentLookupFieldId,
          name: 'Tier Three Parent Name',
          options: {
            linkFieldId: tierThreeLinkFieldId,
            foreignTableId: tierThree.table.id,
            lookupFieldId: tierThreeParentNameFieldId,
          },
        },
        {
          type: 'formula',
          id: effectiveCodeFieldId,
          name: 'Effective Category Code',
          options: {
            expression: `IF({${tierThreeCodeFieldId}}, {${tierThreeCodeFieldId}}, IF({${tierTwoCodeFieldId}}, {${tierTwoCodeFieldId}}, IF({${tierOneCodeFieldId}}, {${tierOneCodeFieldId}}, 0)))`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const tierThreeAssignment = await ctx.createRecord(assignmentTable.id, {
      [assignmentNameFieldId]: 'Tier three selected',
      [tierOneLinkFieldId]: { id: tierOne.record.id },
      [tierTwoLinkFieldId]: { id: tierTwo.record.id },
      [tierThreeLinkFieldId]: { id: tierThree.record.id },
    });
    const emptyAssignment = await ctx.createRecord(assignmentTable.id, {
      [assignmentNameFieldId]: 'No category selected',
    });

    const assignmentValues = async () => {
      await ctx.drainOutbox();
      const records = await ctx.listRecordsWithoutDrain(assignmentTable.id, {
        baseId: targetBaseId,
      });
      return new Map(
        records.map((record) => [
          record.id,
          {
            effectiveCode: record.fields[effectiveCodeFieldId] as number,
            parentName: record.fields[tierThreeParentLookupFieldId],
          },
        ])
      );
    };

    const initialValues = await assignmentValues();
    expect(initialValues.get(tierThreeAssignment.id)).toEqual({
      effectiveCode: 303,
      parentName: ['Tier Two'],
    });
    expect(initialValues.get(emptyAssignment.id)).toEqual({
      effectiveCode: 0,
      parentName: null,
    });

    await ctx.updateRecord(tierThree.table.id, tierThree.record.id, {
      [tierThree.codeFieldId]: 909,
      [tierThreeParentLinkFieldId]: { id: tierTwoUpdated.id },
    });

    const refreshedValues = await assignmentValues();
    expect(refreshedValues.get(tierThreeAssignment.id)).toEqual({
      effectiveCode: 909,
      parentName: ['Tier Two Updated'],
    });

    const baseId = unwrapDomainId(BaseId.create(ctx.baseId));
    const seedTableId = unwrapDomainId(TableId.create(tierThree.table.id));
    const seedRecordId = unwrapDomainId(RecordId.create(tierThree.record.id));
    const targetTableId = unwrapDomainId(TableId.create(assignmentTable.id));
    const sourceCodeFieldId = unwrapDomainId(FieldId.create(tierThree.codeFieldId));
    const targetLinkFieldId = unwrapDomainId(FieldId.create(tierThreeLinkFieldId));
    const targetCodeFieldId = unwrapDomainId(FieldId.create(tierThreeCodeFieldId));
    const targetParentFieldId = unwrapDomainId(FieldId.create(tierThreeParentLookupFieldId));
    const targetFormulaFieldId = unwrapDomainId(FieldId.create(effectiveCodeFieldId));
    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId,
      seedRecordIds: [seedRecordId],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [
        {
          tableId: targetTableId,
          fieldIds: [targetCodeFieldId, targetParentFieldId, targetFormulaFieldId],
          level: 0,
        },
      ],
      edges: [
        {
          fromTableId: seedTableId,
          fromFieldId: sourceCodeFieldId,
          toTableId: targetTableId,
          toFieldId: targetCodeFieldId,
          linkFieldId: targetLinkFieldId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 3,
      changeType: 'update',
      sameTableBatches: [],
    };

    const hasher = ctx.testContainer.container.resolve<IHasher>(v2CoreTokens.hasher);
    const runId = `run_anonymized_nested_lookup_${getRandomString(12)}`;
    const task = buildOutboxTaskInput({
      plan,
      hasher,
      runId,
      originRunIds: [runId],
      runTotalSteps: plan.steps.length,
      runCompletedStepsBefore: 0,
      syncMaxLevel: 0,
    });
    const outbox = ctx.testContainer.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const enqueueResult = await outbox.enqueueOrMerge(task);
    if (enqueueResult.isErr()) {
      throw new Error(enqueueResult.error.message);
    }
    expect(await ctx.testContainer.processOutbox()).toBeGreaterThan(0);

    const matchingDeadLetters = await ctx.testContainer.db
      .selectFrom('computed_update_dead_letter')
      .select(['id', 'last_error'])
      .where('run_id', '=', runId)
      .execute();
    expect(matchingDeadLetters, JSON.stringify(matchingDeadLetters)).toHaveLength(0);
  });
});
