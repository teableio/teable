import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, IRecord } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  isLinkLookupOptions,
  linkFieldOptionsSchema,
  Relationship,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { duplicateField, getFields } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const describeV2 = process.env.FORCE_V2_ALL === 'true' ? describe : describe.skip;

type DuplicateSide = 'created' | 'symmetric';

interface ILinkMatrixCase {
  name: string;
  relationship: Relationship;
  isOneWay: boolean;
  duplicateSide: DuplicateSide;
  duplicatedRelationship: Relationship;
}

const linkMatrix = [
  {
    name: 'manyMany one-way',
    relationship: Relationship.ManyMany,
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.ManyMany,
  },
  {
    name: 'manyMany two-way created side',
    relationship: Relationship.ManyMany,
    isOneWay: false,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.ManyMany,
  },
  {
    name: 'manyMany two-way symmetric side',
    relationship: Relationship.ManyMany,
    isOneWay: false,
    duplicateSide: 'symmetric',
    duplicatedRelationship: Relationship.ManyMany,
  },
  {
    name: 'oneMany one-way junction',
    relationship: Relationship.OneMany,
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.OneMany,
  },
  {
    name: 'manyOne one-way foreign-key holder',
    relationship: Relationship.ManyOne,
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.ManyOne,
  },
  {
    name: 'manyOne two-way foreign-key holder',
    relationship: Relationship.ManyOne,
    isOneWay: false,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.ManyOne,
  },
  {
    name: 'manyOne two-way automatic reverse oneMany',
    relationship: Relationship.ManyOne,
    isOneWay: false,
    duplicateSide: 'symmetric',
    duplicatedRelationship: Relationship.OneMany,
  },
  {
    name: 'oneOne one-way foreign-key holder',
    relationship: Relationship.OneOne,
    isOneWay: true,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.OneOne,
  },
  {
    name: 'oneOne two-way foreign-key holder',
    relationship: Relationship.OneOne,
    isOneWay: false,
    duplicateSide: 'created',
    duplicatedRelationship: Relationship.OneOne,
  },
  {
    name: 'oneOne two-way reverse side',
    relationship: Relationship.OneOne,
    isOneWay: false,
    duplicateSide: 'symmetric',
    duplicatedRelationship: Relationship.OneOne,
  },
] as const satisfies readonly ILinkMatrixCase[];

const fieldById = (fields: IFieldVo[], fieldId: string): IFieldVo => {
  const field = fields.find(({ id }) => id === fieldId);
  if (!field) throw new Error(`Missing field ${fieldId}`);
  return field;
};

const fieldIdByName = (table: ITableFullVo, name: string): string => {
  const field = table.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`Missing field ${name} in table ${table.id}`);
  return field.id;
};

const primaryFieldId = (table: ITableFullVo): string => {
  const field = table.fields.find(({ isPrimary }) => isPrimary);
  if (!field) throw new Error(`Missing primary field in table ${table.id}`);
  return field.id;
};

const firstViewId = (table: ITableFullVo): string => {
  const viewId = table.views[0]?.id;
  if (!viewId) throw new Error(`Missing view in table ${table.id}`);
  return viewId;
};

const recordById = (records: IRecord[], recordId: string): IRecord => {
  const record = records.find(({ id }) => id === recordId);
  if (!record) throw new Error(`Missing record ${recordId}`);
  return record;
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

const linkLookupOptions = (field: IFieldVo) => {
  const options = field.lookupOptions;
  if (!field.isLookup || !isLinkLookupOptions(options)) {
    throw new Error(`Field ${field.id} is not a link lookup`);
  }
  return options;
};

const setLink = async (
  tableId: string,
  recordId: string,
  fieldId: string,
  linkedRecordIds: string[],
  isMultiple: boolean
) => {
  await updateRecord(tableId, recordId, {
    fieldKeyType: FieldKeyType.Id,
    record: {
      fields: {
        [fieldId]: isMultiple
          ? linkedRecordIds.map((id) => ({ id }))
          : linkedRecordIds[0] == null
            ? null
            : { id: linkedRecordIds[0] },
      },
    },
  });
};

const expectLinks = (
  records: IRecord[],
  recordId: string,
  fieldId: string,
  expectedIds: string[]
) => {
  expect(linkedIds(recordById(records, recordId).fields[fieldId])).toEqual(expectedIds);
};

const expectLookupTexts = (
  records: IRecord[],
  recordId: string,
  fieldId: string,
  expectedTexts: string[]
) => {
  expect(lookupTexts(recordById(records, recordId).fields[fieldId])).toEqual(expectedTexts);
};

const createFixtureRecords = async (
  table: ITableFullVo,
  namePrefix: string,
  markerPrefix: string
) => {
  const titleId = primaryFieldId(table);
  const markerId = fieldIdByName(table, 'Marker');
  const names = Array.from({ length: 6 }, (_, index) => `${namePrefix} ${index}`);
  const markers = Array.from({ length: 6 }, (_, index) => `${markerPrefix} ${index}`);
  const created = await createRecords(table.id, {
    fieldKeyType: FieldKeyType.Id,
    records: names.map((name, index) => ({
      fields: {
        [titleId]: name,
        [markerId]: markers[index],
      },
    })),
  });
  return { records: created.records, markerId, markers };
};

const createLinkFixture = async (
  testCase: ILinkMatrixCase,
  createdTable: ITableFullVo,
  foreignTable: ITableFullVo
) => {
  const createdFixture = await createFixtureRecords(createdTable, 'Created row', 'Created marker');
  const foreignFixture = await createFixtureRecords(foreignTable, 'Foreign row', 'Foreign marker');
  const createdLink = await createField(createdTable.id, {
    name: 'Original relation',
    type: FieldType.Link,
    options: {
      relationship: testCase.relationship,
      foreignTableId: foreignTable.id,
      lookupFieldId: primaryFieldId(foreignTable),
      isOneWay: testCase.isOneWay,
    },
  });
  const createdLinkOptions = linkFieldOptionsSchema.parse(createdLink.options);

  if (testCase.duplicateSide === 'symmetric') {
    const symmetricFieldId = createdLinkOptions.symmetricFieldId;
    if (!symmetricFieldId) throw new Error('Expected a symmetric field for reverse-side case');
    const foreignFields = (await getFields(foreignTable.id)).data;
    return {
      hostTable: foreignTable,
      targetTable: createdTable,
      hostRecords: foreignFixture.records,
      targetRecords: createdFixture.records,
      targetMarkerId: createdFixture.markerId,
      targetMarkers: createdFixture.markers,
      originalField: fieldById(foreignFields, symmetricFieldId),
    };
  }

  return {
    hostTable: createdTable,
    targetTable: foreignTable,
    hostRecords: createdFixture.records,
    targetRecords: foreignFixture.records,
    targetMarkerId: foreignFixture.markerId,
    targetMarkers: foreignFixture.markers,
    originalField: createdLink,
  };
};

const cleanupFixtureTables = async (
  baseId: string,
  createdTableId: string | undefined,
  foreignTableId: string | undefined
) => {
  if (createdTableId) {
    try {
      await permanentDeleteTable(baseId, createdTableId);
    } finally {
      if (foreignTableId) await permanentDeleteTable(baseId, foreignTableId);
    }
  } else if (foreignTableId) {
    await permanentDeleteTable(baseId, foreignTableId);
  }
};

describeV2('V2 duplicate link storage matrix (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(linkMatrix)(
    '$name duplicates values into an independent one-way relation',
    async (testCase) => {
      let createdTableId: string | undefined;
      let foreignTableId: string | undefined;

      try {
        const fixtureSuffix = `${testCase.name.replaceAll(' ', '-')}-${Date.now()}`;
        const createdTable = await createTable(baseId, {
          name: `T8231 matrix created ${fixtureSuffix}`,
          fields: [
            { name: 'Created title', type: FieldType.SingleLineText, isPrimary: true },
            { name: 'Marker', type: FieldType.SingleLineText },
          ],
          records: [],
        });
        createdTableId = createdTable.id;

        const foreignTable = await createTable(baseId, {
          name: `T8231 matrix foreign ${fixtureSuffix}`,
          fields: [
            { name: 'Foreign title', type: FieldType.SingleLineText, isPrimary: true },
            { name: 'Marker', type: FieldType.SingleLineText },
          ],
          records: [],
        });
        foreignTableId = foreignTable.id;

        const fixture = await createLinkFixture(testCase, createdTable, foreignTable);
        const {
          hostTable,
          targetTable,
          hostRecords,
          targetRecords,
          targetMarkerId,
          originalField,
        } = fixture;
        let { targetMarkers } = fixture;

        const originalOptions = linkFieldOptionsSchema.parse(originalField.options);
        expect(originalOptions).toMatchObject({
          relationship: testCase.duplicatedRelationship,
          foreignTableId: targetTable.id,
          isOneWay: testCase.isOneWay,
        });

        const isMultiple =
          testCase.duplicatedRelationship === Relationship.ManyMany ||
          testCase.duplicatedRelationship === Relationship.OneMany;
        const initialFirstIds = isMultiple
          ? [targetRecords[2].id, targetRecords[0].id]
          : [targetRecords[2].id];
        const initialSecondIds = [targetRecords[1].id];

        await setLink(
          hostTable.id,
          hostRecords[0].id,
          originalField.id,
          initialFirstIds,
          isMultiple
        );
        await setLink(
          hostTable.id,
          hostRecords[1].id,
          originalField.id,
          initialSecondIds,
          isMultiple
        );

        const hostFieldsBefore = (await getFields(hostTable.id)).data;
        const targetFieldsBefore = (await getFields(targetTable.id)).data;
        const originalBefore = fieldById(hostFieldsBefore, originalField.id);
        const oppositeFieldBefore = originalOptions.symmetricFieldId
          ? fieldById(targetFieldsBefore, originalOptions.symmetricFieldId)
          : undefined;
        const targetRowsBefore = await getRecords(targetTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });

        const duplicated = (
          await duplicateField(hostTable.id, originalField.id, {
            name: 'Independent relation copy',
            viewId: firstViewId(hostTable),
          })
        ).data;
        const duplicatedOptions = linkFieldOptionsSchema.parse(duplicated.options);

        expect(duplicatedOptions).toMatchObject({
          relationship: testCase.duplicatedRelationship,
          foreignTableId: targetTable.id,
          isOneWay: true,
        });
        expect(duplicatedOptions.symmetricFieldId).toBeUndefined();

        const hostFieldsAfter = (await getFields(hostTable.id)).data;
        const targetFieldsAfter = (await getFields(targetTable.id)).data;
        expect(hostFieldsAfter).toHaveLength(hostFieldsBefore.length + 1);
        expect(fieldById(hostFieldsAfter, originalField.id)).toEqual(originalBefore);
        expect(targetFieldsAfter).toEqual(targetFieldsBefore);
        if (oppositeFieldBefore) {
          expect(fieldById(targetFieldsAfter, oppositeFieldBefore.id)).toEqual(oppositeFieldBefore);
        }
        expect(await getRecords(targetTable.id, { fieldKeyType: FieldKeyType.Id })).toEqual(
          targetRowsBefore
        );

        const rowsAfterDuplicate = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        for (const fieldId of [originalField.id, duplicated.id]) {
          expectLinks(rowsAfterDuplicate.records, hostRecords[0].id, fieldId, initialFirstIds);
          expectLinks(rowsAfterDuplicate.records, hostRecords[1].id, fieldId, initialSecondIds);
          expectLinks(rowsAfterDuplicate.records, hostRecords[2].id, fieldId, []);
        }

        const sourceLookup = await createField(hostTable.id, {
          name: 'Original marker lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: targetTable.id,
            linkFieldId: originalField.id,
            lookupFieldId: targetMarkerId,
          },
        });
        const copyLookup = await createField(hostTable.id, {
          name: 'Independent copy marker lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: targetTable.id,
            linkFieldId: duplicated.id,
            lookupFieldId: targetMarkerId,
          },
        });
        expect(linkLookupOptions(sourceLookup)).toMatchObject({
          foreignTableId: targetTable.id,
          linkFieldId: originalField.id,
          lookupFieldId: targetMarkerId,
        });
        expect(linkLookupOptions(copyLookup)).toMatchObject({
          foreignTableId: targetTable.id,
          linkFieldId: duplicated.id,
          lookupFieldId: targetMarkerId,
        });

        const initialFirstMarkers = isMultiple
          ? [targetMarkers[2], targetMarkers[0]]
          : [targetMarkers[2]];
        const initialSecondMarkers = [targetMarkers[1]];
        const rowsWithLookup = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        for (const lookupFieldId of [sourceLookup.id, copyLookup.id]) {
          expectLookupTexts(
            rowsWithLookup.records,
            hostRecords[0].id,
            lookupFieldId,
            initialFirstMarkers
          );
          expectLookupTexts(
            rowsWithLookup.records,
            hostRecords[1].id,
            lookupFieldId,
            initialSecondMarkers
          );
          expectLookupTexts(rowsWithLookup.records, hostRecords[2].id, lookupFieldId, []);
        }

        const updatedMarker = `${testCase.name} updated marker literal`;
        await updateRecord(targetTable.id, targetRecords[2].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [targetMarkerId]: updatedMarker } },
        });
        targetMarkers = [...targetMarkers];
        targetMarkers[2] = updatedMarker;

        const rowsAfterForeignEdit = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        for (const lookupFieldId of [sourceLookup.id, copyLookup.id]) {
          expectLookupTexts(
            rowsAfterForeignEdit.records,
            hostRecords[0].id,
            lookupFieldId,
            isMultiple ? [updatedMarker, targetMarkers[0]] : [updatedMarker]
          );
        }

        const sourceEditIds = [targetRecords[3].id];
        await setLink(hostTable.id, hostRecords[0].id, originalField.id, sourceEditIds, isMultiple);
        const rowsAfterSourceEdit = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expectLinks(
          rowsAfterSourceEdit.records,
          hostRecords[0].id,
          originalField.id,
          sourceEditIds
        );
        expectLinks(rowsAfterSourceEdit.records, hostRecords[0].id, duplicated.id, initialFirstIds);
        expectLookupTexts(rowsAfterSourceEdit.records, hostRecords[0].id, sourceLookup.id, [
          targetMarkers[3],
        ]);
        expectLookupTexts(
          rowsAfterSourceEdit.records,
          hostRecords[0].id,
          copyLookup.id,
          isMultiple ? [updatedMarker, targetMarkers[0]] : [updatedMarker]
        );

        const sourceMarkerAfterSplit = `${testCase.name} source-only marker literal`;
        const copyMarkerAfterSplit = `${testCase.name} copy-only marker literal`;
        await updateRecord(targetTable.id, targetRecords[3].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [targetMarkerId]: sourceMarkerAfterSplit } },
        });
        await updateRecord(targetTable.id, targetRecords[2].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [targetMarkerId]: copyMarkerAfterSplit } },
        });
        targetMarkers[3] = sourceMarkerAfterSplit;
        targetMarkers[2] = copyMarkerAfterSplit;

        const rowsAfterSplitForeignEdits = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expectLookupTexts(rowsAfterSplitForeignEdits.records, hostRecords[0].id, sourceLookup.id, [
          sourceMarkerAfterSplit,
        ]);
        expectLookupTexts(
          rowsAfterSplitForeignEdits.records,
          hostRecords[0].id,
          copyLookup.id,
          isMultiple ? [copyMarkerAfterSplit, targetMarkers[0]] : [copyMarkerAfterSplit]
        );

        const targetRowsAfterSourceEdit = await getRecords(targetTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        const copyEditIds = isMultiple
          ? [targetRecords[5].id, targetRecords[4].id]
          : [targetRecords[4].id];
        await setLink(hostTable.id, hostRecords[0].id, duplicated.id, copyEditIds, isMultiple);

        const rowsAfterCopyEdit = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expectLinks(rowsAfterCopyEdit.records, hostRecords[0].id, originalField.id, sourceEditIds);
        expectLinks(rowsAfterCopyEdit.records, hostRecords[0].id, duplicated.id, copyEditIds);
        expectLookupTexts(rowsAfterCopyEdit.records, hostRecords[0].id, sourceLookup.id, [
          sourceMarkerAfterSplit,
        ]);
        expectLookupTexts(
          rowsAfterCopyEdit.records,
          hostRecords[0].id,
          copyLookup.id,
          isMultiple ? [targetMarkers[5], targetMarkers[4]] : [targetMarkers[4]]
        );
        expect(await getRecords(targetTable.id, { fieldKeyType: FieldKeyType.Id })).toEqual(
          targetRowsAfterSourceEdit
        );

        await setLink(hostTable.id, hostRecords[0].id, duplicated.id, [], isMultiple);
        const rowsAfterCopyClear = await getRecords(hostTable.id, {
          fieldKeyType: FieldKeyType.Id,
        });
        expectLinks(rowsAfterCopyClear.records, hostRecords[0].id, originalField.id, sourceEditIds);
        expectLinks(rowsAfterCopyClear.records, hostRecords[0].id, duplicated.id, []);
        expectLookupTexts(rowsAfterCopyClear.records, hostRecords[0].id, sourceLookup.id, [
          sourceMarkerAfterSplit,
        ]);
        expectLookupTexts(rowsAfterCopyClear.records, hostRecords[0].id, copyLookup.id, []);
        expect(await getRecords(targetTable.id, { fieldKeyType: FieldKeyType.Id })).toEqual(
          targetRowsAfterSourceEdit
        );
      } finally {
        await cleanupFixtureTables(baseId, createdTableId, foreignTableId);
      }
    }
  );
});
