import {
  duplicateFieldOkResponseSchema,
  type IFieldDto,
  type ITableDto,
  type ITableRecordDto,
} from '@teable/v2-contract-http';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type LinkFieldDto = Extract<IFieldDto, { type: 'link' }>;
type Relationship = 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
type DuplicateSide = 'created' | 'symmetric';

interface LinkMatrixCase {
  name: string;
  relationship: Relationship;
  isOneWay: boolean;
  duplicateSide: DuplicateSide;
  duplicatedRelationship: Relationship;
}

const linkMatrix = [
  {
    name: 'manyMany one-way',
    relationship: 'manyMany',
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: 'manyMany',
  },
  {
    name: 'manyMany two-way created side',
    relationship: 'manyMany',
    isOneWay: false,
    duplicateSide: 'created',
    duplicatedRelationship: 'manyMany',
  },
  {
    name: 'manyMany two-way symmetric side',
    relationship: 'manyMany',
    isOneWay: false,
    duplicateSide: 'symmetric',
    duplicatedRelationship: 'manyMany',
  },
  {
    name: 'oneMany one-way junction',
    relationship: 'oneMany',
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: 'oneMany',
  },
  {
    name: 'manyOne one-way foreign-key holder',
    relationship: 'manyOne',
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: 'manyOne',
  },
  {
    name: 'manyOne two-way foreign-key holder',
    relationship: 'manyOne',
    isOneWay: false,
    duplicateSide: 'created',
    duplicatedRelationship: 'manyOne',
  },
  {
    name: 'manyOne two-way automatic reverse oneMany',
    relationship: 'manyOne',
    isOneWay: false,
    duplicateSide: 'symmetric',
    duplicatedRelationship: 'oneMany',
  },
  {
    name: 'oneOne one-way foreign-key holder',
    relationship: 'oneOne',
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: 'oneOne',
  },
  {
    name: 'oneOne two-way foreign-key holder',
    relationship: 'oneOne',
    isOneWay: false,
    duplicateSide: 'created',
    duplicatedRelationship: 'oneOne',
  },
  {
    name: 'oneOne two-way reverse side',
    relationship: 'oneOne',
    isOneWay: false,
    duplicateSide: 'symmetric',
    duplicatedRelationship: 'oneOne',
  },
] as const satisfies readonly LinkMatrixCase[];

const fieldByName = (table: ITableDto, name: string): IFieldDto => {
  const field = table.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`Missing field ${name} in table ${table.id}`);
  return field;
};

const linkFieldById = (table: ITableDto, fieldId: string): LinkFieldDto => {
  const field = table.fields.find((candidate) => candidate.id === fieldId);
  if (!field || field.type !== 'link') {
    throw new Error(`Missing link field ${fieldId} in table ${table.id}`);
  }
  return field;
};

const primaryFieldId = (table: ITableDto): string => {
  const field = table.fields.find(({ isPrimary }) => isPrimary);
  if (!field) throw new Error(`Missing primary field in table ${table.id}`);
  return field.id;
};

const recordById = (records: ITableRecordDto[], recordId: string): ITableRecordDto => {
  const record = records.find(({ id }) => id === recordId);
  if (!record) throw new Error(`Missing record ${recordId}`);
  return record;
};

// computeMeta carries per-run scheduling telemetry (e.g. lastDurationMs) that differs between
// PGlite and PostgreSQL; schema comparisons must not depend on it.
const schemaShape = (field: IFieldDto): Record<string, unknown> => {
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(field));
  delete copy.computeMeta;
  return copy;
};

const linkedIds = (value: unknown): string[] => {
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => {
    if (entry == null || typeof entry !== 'object') {
      throw new Error(`Expected link object, received ${JSON.stringify(entry)}`);
    }
    const id = Reflect.get(entry, 'id');
    if (typeof id !== 'string') throw new Error('Link object is missing a string id');
    return id;
  });
};

const lookupTexts = (value: unknown): string[] => {
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`Expected lookup text, received ${JSON.stringify(entry)}`);
    }
    return entry;
  });
};

const expectLinks = (
  records: ITableRecordDto[],
  recordId: string,
  fieldId: string,
  expectedIds: string[]
) => {
  expect(linkedIds(recordById(records, recordId).fields[fieldId])).toEqual(expectedIds);
};

const expectLookupTexts = (
  records: ITableRecordDto[],
  recordId: string,
  fieldId: string,
  expectedTexts: string[]
) => {
  expect(lookupTexts(recordById(records, recordId).fields[fieldId])).toEqual(expectedTexts);
};

const duplicateField = async (
  ctx: SharedTestContext,
  payload: {
    tableId: string;
    fieldId: string;
    newFieldName: string;
    viewId: string;
  }
) => {
  const response = await fetch(`${ctx.baseUrl}/tables/duplicateField`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseId: ctx.baseId,
      includeRecordValues: true,
      ...payload,
    }),
  });
  const raw: unknown = await response.json();
  if (response.status !== 200) {
    throw new Error(`duplicateField failed for ${payload.fieldId}: ${JSON.stringify(raw)}`);
  }
  const parsed = duplicateFieldOkResponseSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`duplicateField response invalid: ${JSON.stringify(raw)}`);
  }
  return parsed.data.data;
};

const createFixtureRecords = async (
  ctx: SharedTestContext,
  table: ITableDto,
  namePrefix: string,
  markerPrefix: string
) => {
  const titleId = primaryFieldId(table);
  const markerId = fieldByName(table, 'Marker').id;
  const names = Array.from({ length: 6 }, (_, index) => `${namePrefix} ${index}`);
  const markers = Array.from({ length: 6 }, (_, index) => `${markerPrefix} ${index}`);
  const records = await ctx.createRecords(
    table.id,
    names.map((name, index) => ({
      fields: {
        [titleId]: name,
        [markerId]: markers[index],
      },
    }))
  );
  return { records, markerId, markers };
};

const createLinkFixture = async (
  ctx: SharedTestContext,
  testCase: LinkMatrixCase,
  createdTable: ITableDto,
  foreignTable: ITableDto
) => {
  const createdFixture = await createFixtureRecords(
    ctx,
    createdTable,
    'Created row',
    'Created marker'
  );
  const foreignFixture = await createFixtureRecords(
    ctx,
    foreignTable,
    'Foreign row',
    'Foreign marker'
  );
  const tableWithLink = await ctx.createField({
    baseId: ctx.baseId,
    tableId: createdTable.id,
    field: {
      name: 'Original relation',
      type: 'link',
      options: {
        relationship: testCase.relationship,
        foreignTableId: foreignTable.id,
        lookupFieldId: primaryFieldId(foreignTable),
        isOneWay: testCase.isOneWay,
      },
    },
  });
  const createdLink = fieldByName(tableWithLink, 'Original relation');
  if (createdLink.type !== 'link') throw new Error('Created relation is not a link field');

  if (testCase.duplicateSide === 'symmetric') {
    const symmetricFieldId = createdLink.options.symmetricFieldId;
    if (!symmetricFieldId) throw new Error('Expected a symmetric field for reverse-side case');
    const latestForeignTable = await ctx.getTableById(foreignTable.id);
    return {
      hostTable: latestForeignTable,
      targetTable: tableWithLink,
      hostRecords: foreignFixture.records,
      targetRecords: createdFixture.records,
      targetMarkerId: createdFixture.markerId,
      targetMarkers: createdFixture.markers,
      originalField: linkFieldById(latestForeignTable, symmetricFieldId),
    };
  }

  return {
    hostTable: tableWithLink,
    targetTable: await ctx.getTableById(foreignTable.id),
    hostRecords: createdFixture.records,
    targetRecords: foreignFixture.records,
    targetMarkerId: foreignFixture.markerId,
    targetMarkers: foreignFixture.markers,
    originalField: createdLink,
  };
};

const createLookup = async (
  ctx: SharedTestContext,
  tableId: string,
  name: string,
  foreignTableId: string,
  linkFieldId: string,
  lookupFieldId: string
): Promise<IFieldDto> => {
  const table = await ctx.createField({
    baseId: ctx.baseId,
    tableId,
    field: {
      name,
      type: 'lookup',
      options: { foreignTableId, linkFieldId, lookupFieldId },
    },
  });
  const field = fieldByName(table, name);
  expect(field.isLookup).toBe(true);
  expect(field.lookupOptions).toMatchObject({ foreignTableId, linkFieldId, lookupFieldId });
  return field;
};

const setLink = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fieldId: string,
  linkedRecordIds: string[],
  isMultiple: boolean
) => {
  await ctx.updateRecord(tableId, recordId, {
    [fieldId]: isMultiple
      ? linkedRecordIds.map((id) => ({ id }))
      : linkedRecordIds[0] == null
        ? null
        : { id: linkedRecordIds[0] },
  });
};

const cleanupFixtureTables = async (
  ctx: SharedTestContext,
  createdTableId: string | undefined,
  foreignTableId: string | undefined
) => {
  if (createdTableId) {
    try {
      await ctx.deleteTable(createdTableId);
    } finally {
      if (foreignTableId) await ctx.deleteTable(foreignTableId);
    }
    return;
  }
  if (foreignTableId) await ctx.deleteTable(foreignTableId);
};

describe('[B07] duplicateField link storage matrix', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext({
      dbMode: process.env.TEABLE_V2_TEST_DATABASE_URL ? 'postgres' : 'pglite',
    });
  });

  it.each(linkMatrix)(
    '$name duplicates values into an independent one-way relation',
    async (testCase) => {
      let createdTableId: string | undefined;
      let foreignTableId: string | undefined;

      try {
        const suffix = `${testCase.name.replaceAll(' ', '-')}-${Date.now()}`;
        const createdTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T8231 matrix created ${suffix}`,
          fields: [
            { name: 'Created title', type: 'singleLineText', isPrimary: true },
            { name: 'Marker', type: 'singleLineText' },
          ],
        });
        createdTableId = createdTable.id;

        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T8231 matrix foreign ${suffix}`,
          fields: [
            { name: 'Foreign title', type: 'singleLineText', isPrimary: true },
            { name: 'Marker', type: 'singleLineText' },
          ],
        });
        foreignTableId = foreignTable.id;

        const fixture = await createLinkFixture(ctx, testCase, createdTable, foreignTable);
        const {
          hostTable,
          targetTable,
          hostRecords,
          targetRecords,
          targetMarkerId,
          originalField,
        } = fixture;
        const targetMarkers = [...fixture.targetMarkers];

        expect(originalField.options).toMatchObject({
          relationship: testCase.duplicatedRelationship,
          foreignTableId: targetTable.id,
        });
        expect(originalField.options.isOneWay ?? false).toBe(testCase.isOneWay);

        const isMultiple =
          testCase.duplicatedRelationship === 'manyMany' ||
          testCase.duplicatedRelationship === 'oneMany';
        const initialFirstIds = isMultiple
          ? [targetRecords[2].id, targetRecords[0].id]
          : [targetRecords[2].id];
        const initialSecondIds = [targetRecords[1].id];

        await setLink(
          ctx,
          hostTable.id,
          hostRecords[0].id,
          originalField.id,
          initialFirstIds,
          isMultiple
        );
        await setLink(
          ctx,
          hostTable.id,
          hostRecords[1].id,
          originalField.id,
          initialSecondIds,
          isMultiple
        );
        await ctx.drainOutbox();

        const hostBefore = await ctx.getTableById(hostTable.id);
        const targetBefore = await ctx.getTableById(targetTable.id);
        const originalBefore = linkFieldById(hostBefore, originalField.id);
        const oppositeBefore = originalField.options.symmetricFieldId
          ? linkFieldById(targetBefore, originalField.options.symmetricFieldId)
          : undefined;
        const originalShape = schemaShape(originalBefore);
        const oppositeShape = oppositeBefore ? schemaShape(oppositeBefore) : undefined;
        const targetShapesBefore = targetBefore.fields.map(schemaShape);
        const targetRowsBefore = await ctx.listRecordsWithoutDrain(targetTable.id);
        const hostViewId = hostTable.views[0]?.id;
        if (!hostViewId) throw new Error(`Missing view in table ${hostTable.id}`);

        const duplicatedResult = await duplicateField(ctx, {
          tableId: hostTable.id,
          fieldId: originalField.id,
          newFieldName: 'Independent relation copy',
          viewId: hostViewId,
        });
        await ctx.drainOutbox();
        const duplicated = linkFieldById(duplicatedResult.table, duplicatedResult.newFieldId);

        expect(duplicated.options).toMatchObject({
          relationship: testCase.duplicatedRelationship,
          foreignTableId: targetTable.id,
          isOneWay: true,
        });
        expect(duplicated.options.symmetricFieldId).toBeUndefined();

        const hostAfter = await ctx.getTableById(hostTable.id);
        const targetAfter = await ctx.getTableById(targetTable.id);
        expect(hostAfter.fields).toHaveLength(hostBefore.fields.length + 1);
        const originalAfter = linkFieldById(hostAfter, originalField.id);
        expect(schemaShape(originalAfter)).toEqual(originalShape);
        expect(targetAfter.fields.map(schemaShape)).toEqual(targetShapesBefore);
        if (oppositeBefore) {
          const oppositeAfter = linkFieldById(targetAfter, oppositeBefore.id);
          expect(schemaShape(oppositeAfter)).toEqual(oppositeShape);
        }
        expect(await ctx.listRecordsWithoutDrain(targetTable.id)).toEqual(targetRowsBefore);

        const rowsAfterDuplicate = await ctx.listRecordsWithoutDrain(hostTable.id);
        for (const fieldId of [originalField.id, duplicated.id]) {
          expectLinks(rowsAfterDuplicate, hostRecords[0].id, fieldId, initialFirstIds);
          expectLinks(rowsAfterDuplicate, hostRecords[1].id, fieldId, initialSecondIds);
          expectLinks(rowsAfterDuplicate, hostRecords[2].id, fieldId, []);
        }

        const sourceLookup = await createLookup(
          ctx,
          hostTable.id,
          'Original marker lookup',
          targetTable.id,
          originalField.id,
          targetMarkerId
        );
        const copyLookup = await createLookup(
          ctx,
          hostTable.id,
          'Independent copy marker lookup',
          targetTable.id,
          duplicated.id,
          targetMarkerId
        );
        await ctx.drainOutbox();

        const initialFirstMarkers = isMultiple
          ? [targetMarkers[2], targetMarkers[0]]
          : [targetMarkers[2]];
        const initialSecondMarkers = [targetMarkers[1]];
        const rowsWithLookup = await ctx.listRecordsWithoutDrain(hostTable.id);
        for (const lookupFieldId of [sourceLookup.id, copyLookup.id]) {
          expectLookupTexts(rowsWithLookup, hostRecords[0].id, lookupFieldId, initialFirstMarkers);
          expectLookupTexts(rowsWithLookup, hostRecords[1].id, lookupFieldId, initialSecondMarkers);
          expectLookupTexts(rowsWithLookup, hostRecords[2].id, lookupFieldId, []);
        }

        const updatedMarker = `${testCase.name} updated marker literal`;
        await ctx.updateRecord(targetTable.id, targetRecords[2].id, {
          [targetMarkerId]: updatedMarker,
        });
        targetMarkers[2] = updatedMarker;
        await ctx.drainOutbox();

        const rowsAfterForeignEdit = await ctx.listRecordsWithoutDrain(hostTable.id);
        for (const lookupFieldId of [sourceLookup.id, copyLookup.id]) {
          expectLookupTexts(
            rowsAfterForeignEdit,
            hostRecords[0].id,
            lookupFieldId,
            isMultiple ? [updatedMarker, targetMarkers[0]] : [updatedMarker]
          );
        }

        const sourceEditIds = [targetRecords[3].id];
        await setLink(
          ctx,
          hostTable.id,
          hostRecords[0].id,
          originalField.id,
          sourceEditIds,
          isMultiple
        );
        await ctx.drainOutbox();
        const rowsAfterSourceEdit = await ctx.listRecordsWithoutDrain(hostTable.id);
        expectLinks(rowsAfterSourceEdit, hostRecords[0].id, originalField.id, sourceEditIds);
        expectLinks(rowsAfterSourceEdit, hostRecords[0].id, duplicated.id, initialFirstIds);
        expectLookupTexts(rowsAfterSourceEdit, hostRecords[0].id, sourceLookup.id, [
          targetMarkers[3],
        ]);
        expectLookupTexts(
          rowsAfterSourceEdit,
          hostRecords[0].id,
          copyLookup.id,
          isMultiple ? [updatedMarker, targetMarkers[0]] : [updatedMarker]
        );

        const sourceMarkerAfterSplit = `${testCase.name} source-only marker literal`;
        const copyMarkerAfterSplit = `${testCase.name} copy-only marker literal`;
        await ctx.updateRecord(targetTable.id, targetRecords[3].id, {
          [targetMarkerId]: sourceMarkerAfterSplit,
        });
        await ctx.updateRecord(targetTable.id, targetRecords[2].id, {
          [targetMarkerId]: copyMarkerAfterSplit,
        });
        targetMarkers[3] = sourceMarkerAfterSplit;
        targetMarkers[2] = copyMarkerAfterSplit;
        await ctx.drainOutbox();

        const rowsAfterSplitForeignEdits = await ctx.listRecordsWithoutDrain(hostTable.id);
        expectLookupTexts(rowsAfterSplitForeignEdits, hostRecords[0].id, sourceLookup.id, [
          sourceMarkerAfterSplit,
        ]);
        expectLookupTexts(
          rowsAfterSplitForeignEdits,
          hostRecords[0].id,
          copyLookup.id,
          isMultiple ? [copyMarkerAfterSplit, targetMarkers[0]] : [copyMarkerAfterSplit]
        );

        const targetRowsAfterSourceEdit = await ctx.listRecordsWithoutDrain(targetTable.id);
        const copyEditIds = isMultiple
          ? [targetRecords[5].id, targetRecords[4].id]
          : [targetRecords[4].id];
        await setLink(ctx, hostTable.id, hostRecords[0].id, duplicated.id, copyEditIds, isMultiple);
        await ctx.drainOutbox();

        const rowsAfterCopyEdit = await ctx.listRecordsWithoutDrain(hostTable.id);
        expectLinks(rowsAfterCopyEdit, hostRecords[0].id, originalField.id, sourceEditIds);
        expectLinks(rowsAfterCopyEdit, hostRecords[0].id, duplicated.id, copyEditIds);
        expectLookupTexts(rowsAfterCopyEdit, hostRecords[0].id, sourceLookup.id, [
          sourceMarkerAfterSplit,
        ]);
        expectLookupTexts(
          rowsAfterCopyEdit,
          hostRecords[0].id,
          copyLookup.id,
          isMultiple ? [targetMarkers[5], targetMarkers[4]] : [targetMarkers[4]]
        );
        expect(await ctx.listRecordsWithoutDrain(targetTable.id)).toEqual(
          targetRowsAfterSourceEdit
        );

        await setLink(ctx, hostTable.id, hostRecords[0].id, duplicated.id, [], isMultiple);
        await ctx.drainOutbox();
        const rowsAfterCopyClear = await ctx.listRecordsWithoutDrain(hostTable.id);
        expectLinks(rowsAfterCopyClear, hostRecords[0].id, originalField.id, sourceEditIds);
        expectLinks(rowsAfterCopyClear, hostRecords[0].id, duplicated.id, []);
        expectLookupTexts(rowsAfterCopyClear, hostRecords[0].id, sourceLookup.id, [
          sourceMarkerAfterSplit,
        ]);
        expectLookupTexts(rowsAfterCopyClear, hostRecords[0].id, copyLookup.id, []);
        expect(await ctx.listRecordsWithoutDrain(targetTable.id)).toEqual(
          targetRowsAfterSourceEdit
        );
      } finally {
        await cleanupFixtureTables(ctx, createdTableId, foreignTableId);
      }
    }
  );
});
