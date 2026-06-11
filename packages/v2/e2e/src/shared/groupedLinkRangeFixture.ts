import type { SharedTestContext } from './globalTestContext';

type GroupByClause = { fieldId: string; order: 'asc' | 'desc' };

export interface GroupedLinkRangeFixture {
  tableId: string;
  viewId: string;
  nameFieldId: string;
  platformFieldId: string;
  groupByAsc: GroupByClause[];
  expectedGroupedAscOrderIds: string[];
  recordIds: {
    github1: string;
    github2: string;
    linkedIn1: string;
    linkedIn2: string;
    x1: string;
  };
}

export const setupGroupedLinkRangeFixture = async (
  ctx: SharedTestContext,
  label: string
): Promise<GroupedLinkRangeFixture> => {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const platformTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Grouped Link Platforms ${suffix}`,
    fields: [{ name: 'Name', type: 'singleLineText', isPrimary: true }],
    views: [{ type: 'grid' }],
  });

  const platformNameFieldId = platformTable.fields.find((field) => field.isPrimary)?.id;
  if (!platformNameFieldId) {
    throw new Error('Failed to resolve platform primary field');
  }

  const githubPlatform = await ctx.createRecord(platformTable.id, {
    [platformNameFieldId]: 'Github',
  });
  const linkedInPlatform = await ctx.createRecord(platformTable.id, {
    [platformNameFieldId]: 'LinkedIn',
  });
  const xPlatform = await ctx.createRecord(platformTable.id, { [platformNameFieldId]: 'X' });

  const hostTable = await ctx.createTable({
    baseId: ctx.baseId,
    name: `Grouped Link Host ${suffix}`,
    fields: [
      { name: 'Name', type: 'singleLineText', isPrimary: true },
      {
        name: 'Platform',
        type: 'link',
        options: {
          relationship: 'manyOne',
          foreignTableId: platformTable.id,
          lookupFieldId: platformNameFieldId,
          isOneWay: true,
        },
      },
    ],
    views: [{ type: 'grid' }],
  });

  const nameFieldId = hostTable.fields.find((field) => field.isPrimary)?.id;
  const platformFieldId = hostTable.fields.find((field) => field.name === 'Platform')?.id;
  const viewId = hostTable.views[0]?.id;

  if (!nameFieldId || !platformFieldId || !viewId) {
    throw new Error('Failed to resolve grouped link fixture field metadata');
  }

  const linkedIn1 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'LinkedIn 1',
    [platformFieldId]: { id: linkedInPlatform.id },
  });
  const github1 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'Github 1',
    [platformFieldId]: { id: githubPlatform.id },
  });
  const x1 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'X 1',
    [platformFieldId]: { id: xPlatform.id },
  });
  const github2 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'Github 2',
    [platformFieldId]: { id: githubPlatform.id },
  });
  const linkedIn2 = await ctx.createRecord(hostTable.id, {
    [nameFieldId]: 'LinkedIn 2',
    [platformFieldId]: { id: linkedInPlatform.id },
  });

  await ctx.drainOutbox();

  return {
    tableId: hostTable.id,
    viewId,
    nameFieldId,
    platformFieldId,
    groupByAsc: [{ fieldId: platformFieldId, order: 'asc' }],
    expectedGroupedAscOrderIds: [github1.id, github2.id, linkedIn1.id, linkedIn2.id, x1.id],
    recordIds: {
      github1: github1.id,
      github2: github2.id,
      linkedIn1: linkedIn1.id,
      linkedIn2: linkedIn2.id,
      x1: x1.id,
    },
  };
};
