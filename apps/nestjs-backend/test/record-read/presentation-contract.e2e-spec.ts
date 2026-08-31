import fs from 'fs';
import os from 'os';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import {
  CellFormat,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  RatingIcon,
  Relationship,
  SortFunc,
} from '@teable/core';
import type { ICreateTableRo, IGetRecordsRo, IRecordsVo, ITableFullVo } from '@teable/openapi';
import {
  GET_RECORDS_URL,
  X_CANARY_HEADER,
  axios,
  uploadAttachment,
  urlBuilder,
} from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from '../utils/init-app';

// This suite owns response presentation compatibility. Filter/sort/group row-selection
// semantics are covered separately by their query and authority matrices.
describe('Record read V1/V2 presentation contract (e2e)', () => {
  let app: INestApplication;
  let previousForceV2All: string | undefined;
  let previousEnableCanaryFeature: string | undefined;
  let attachmentFixturePath: string;

  const baseId = globalThis.testConfig.baseId;
  const primaryFieldId = `fld${'p'.repeat(16)}`;
  const longTextFieldId = `fld${'l'.repeat(16)}`;
  const numberFieldId = `fld${'n'.repeat(16)}`;
  const ratingFieldId = `fld${'r'.repeat(16)}`;
  const singleSelectFieldId = `fld${'s'.repeat(16)}`;
  const multipleSelectFieldId = `fld${'m'.repeat(16)}`;
  const checkboxFieldId = `fld${'c'.repeat(16)}`;
  const dateFieldId = `fld${'d'.repeat(16)}`;
  const formulaFieldId = `fld${'f'.repeat(16)}`;
  const autoNumberFieldId = `fld${'a'.repeat(16)}`;
  const createdTimeFieldId = `fld${'t'.repeat(16)}`;
  const lastModifiedTimeFieldId = `fld${'i'.repeat(16)}`;
  const createdByFieldId = `fld${'u'.repeat(16)}`;
  const lastModifiedByFieldId = `fld${'v'.repeat(16)}`;
  const userFieldId = `fld${'w'.repeat(16)}`;
  const multipleUserFieldId = `fld${'z'.repeat(16)}`;
  const formulaDateFieldId = `fld${'j'.repeat(16)}`;
  const formulaBooleanFieldId = `fld${'h'.repeat(16)}`;
  const foreignNameFieldId = `fld${'q'.repeat(16)}`;
  const foreignRevenueFieldId = `fld${'e'.repeat(16)}`;
  const attachmentFieldId = `fld${'x'.repeat(16)}`;
  const foreignAttachmentFieldId = `fld${'2'.repeat(16)}`;
  const attachmentLookupFieldId = `fld${'3'.repeat(16)}`;
  const conditionalAttachmentLookupFieldId = `fld${'4'.repeat(16)}`;
  const buttonFieldId = `fld${'b'.repeat(16)}`;
  const linkFieldId = `fld${'k'.repeat(16)}`;
  const multipleLinkFieldId = `fld${'g'.repeat(16)}`;
  const lookupFieldId = `fld${'o'.repeat(16)}`;
  const rollupFieldId = `fld${'y'.repeat(16)}`;
  const conditionalLookupFieldId = `fld${'0'.repeat(16)}`;
  const conditionalRollupFieldId = `fld${'1'.repeat(16)}`;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'true';

    const appCtx = await initApp();
    app = appCtx.app;
    attachmentFixturePath = path.join(os.tmpdir(), `teable-record-presentation-${Date.now()}.txt`);
    fs.writeFileSync(attachmentFixturePath, 'presentation contract attachment');
  });

  afterAll(async () => {
    if (fs.existsSync(attachmentFixturePath)) {
      fs.unlinkSync(attachmentFixturePath);
    }
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    if (previousEnableCanaryFeature == null) {
      delete process.env.ENABLE_CANARY_FEATURE;
    } else {
      process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
    }
    await app.close();
  });

  const getRecordsFromVersion = async (tableId: string, useV2: boolean, query: IGetRecordsRo) => {
    const response = await axios.get<IRecordsVo>(urlBuilder(GET_RECORDS_URL, { tableId }), {
      params: query,
      headers: {
        [X_CANARY_HEADER]: useV2 ? 'true' : 'false',
      },
    });

    expect(response.headers['x-teable-v2']).toBe(useV2 ? 'true' : 'false');
    expect(response.headers['x-teable-v2-feature']).toBe('getRecords');
    return response.data;
  };

  const createPresentationTable = async (): Promise<ITableFullVo> => {
    const table = await createTable(baseId, {
      name: `record-presentation-${Date.now()}`,
      fields: [
        {
          id: primaryFieldId,
          name: 'Name',
          type: FieldType.SingleLineText,
          isPrimary: true,
        },
        {
          id: longTextFieldId,
          name: 'Description',
          type: FieldType.LongText,
        },
        {
          id: numberFieldId,
          name: 'Amount',
          type: FieldType.Number,
          options: {
            formatting: {
              type: NumberFormattingType.Decimal,
              precision: 2,
            },
          },
        },
        {
          id: ratingFieldId,
          name: 'Rating',
          type: FieldType.Rating,
          options: {
            max: 5,
            icon: RatingIcon.Star,
            color: 'yellowBright',
          },
        },
        {
          id: singleSelectFieldId,
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { name: 'Todo', color: 'blue' },
              { name: 'Done', color: 'green' },
            ],
          },
        },
        {
          id: multipleSelectFieldId,
          name: 'Tags',
          type: FieldType.MultipleSelect,
          options: {
            choices: [
              { name: 'Frontend', color: 'purple' },
              { name: 'Backend', color: 'orange' },
            ],
          },
        },
        {
          id: checkboxFieldId,
          name: 'Done',
          type: FieldType.Checkbox,
        },
        {
          id: dateFieldId,
          name: 'Due Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'HH:mm',
              timeZone: 'UTC',
            },
          },
        },
        {
          id: formulaFieldId,
          name: 'Double Amount',
          type: FieldType.Formula,
          options: {
            expression: `{${numberFieldId}} * 2`,
            formatting: {
              type: NumberFormattingType.Decimal,
              precision: 1,
            },
          },
        },
        {
          id: formulaDateFieldId,
          name: 'Formula Due Date',
          type: FieldType.Formula,
          options: {
            expression: `{${dateFieldId}}`,
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'HH:mm',
              timeZone: 'UTC',
            },
          },
        },
        {
          id: formulaBooleanFieldId,
          name: 'Formula Done',
          type: FieldType.Formula,
          options: {
            expression: `{${checkboxFieldId}}`,
          },
        },
        {
          id: autoNumberFieldId,
          name: 'Auto Number',
          type: FieldType.AutoNumber,
        },
        {
          id: createdTimeFieldId,
          name: 'Created Time',
          type: FieldType.CreatedTime,
        },
        {
          id: lastModifiedTimeFieldId,
          name: 'Last Modified Time',
          type: FieldType.LastModifiedTime,
        },
        {
          id: createdByFieldId,
          name: 'Created By',
          type: FieldType.CreatedBy,
        },
        {
          id: lastModifiedByFieldId,
          name: 'Last Modified By',
          type: FieldType.LastModifiedBy,
        },
        {
          id: userFieldId,
          name: 'Owner',
          type: FieldType.User,
          options: {
            isMultiple: false,
            shouldNotify: false,
          },
        },
        {
          id: multipleUserFieldId,
          name: 'Reviewers',
          type: FieldType.User,
          options: {
            isMultiple: true,
            shouldNotify: false,
          },
        },
      ],
      records: [],
    } as unknown as ICreateTableRo);

    const created = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: [
        {
          fields: {
            [primaryFieldId]: 'Presentation row',
            [longTextFieldId]: 'Line one\nLine two',
            [numberFieldId]: 1.234,
            [ratingFieldId]: 4,
            [singleSelectFieldId]: 'Todo',
            [multipleSelectFieldId]: ['Frontend', 'Backend'],
            [checkboxFieldId]: true,
            [dateFieldId]: '2026-07-28T12:34:00.000Z',
            [userFieldId]: globalThis.testConfig.userId,
            [multipleUserFieldId]: [globalThis.testConfig.userId],
          },
        },
        {
          fields: {
            [primaryFieldId]: 'Empty row',
            [checkboxFieldId]: false,
          },
        },
      ],
    });

    await updateRecordByApi(table.id, created.records[0]!.id, primaryFieldId, 'Presentation row');
    return table;
  };

  it('matches scalar, selection, temporal, system, computed, and user JSON shapes', async () => {
    const table = await createPresentationTable();
    try {
      const query = {
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Json,
      };
      const v1 = await getRecordsFromVersion(table.id, false, query);
      const v2 = await getRecordsFromVersion(table.id, true, query);

      expect(v2.records).toEqual(v1.records);
      expect(v1.records[0]?.fields[userFieldId]).toMatchObject({
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
      });
      expect(v1.records[0]?.fields[createdByFieldId]).toMatchObject({
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
      });
      expect(v1.records[0]?.fields[lastModifiedByFieldId]).toMatchObject({
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
      });
      expect(v1.records[0]?.fields[multipleUserFieldId]).toEqual([
        expect.objectContaining({
          id: globalThis.testConfig.userId,
          title: globalThis.testConfig.userName,
        }),
      ]);
      expect(v1.records[0]?.fields[formulaDateFieldId]).toBe('2026-07-28T12:34:00.000Z');
      expect(v1.records[0]?.fields[formulaBooleanFieldId]).toBe(true);
      const emptyRecord = v1.records.find(
        (record) => record.fields[primaryFieldId] === 'Empty row'
      );
      expect(emptyRecord?.fields).not.toHaveProperty(checkboxFieldId);
      expect(emptyRecord?.fields).not.toHaveProperty(numberFieldId);
      expect(emptyRecord?.fields).not.toHaveProperty(dateFieldId);
      expect(emptyRecord?.fields).not.toHaveProperty(userFieldId);
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('matches configured display text for the same fields', async () => {
    const table = await createPresentationTable();
    try {
      const query = {
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Text,
      };
      const v1 = await getRecordsFromVersion(table.id, false, query);
      const v2 = await getRecordsFromVersion(table.id, true, query);

      expect(v2.records).toEqual(v1.records);
      expect(v1.records[0]?.fields[numberFieldId]).toBe('1.23');
      expect(v1.records[0]?.fields[formulaFieldId]).toBe('2.5');
      expect(v1.records[0]?.fields[dateFieldId]).toBe('2026-07-28 12:34');
      expect(v1.records[0]?.fields[formulaDateFieldId]).toBe('2026-07-28 12:34');
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('matches checkbox, selection, and user group-header shapes', async () => {
    const table = await createPresentationTable();
    try {
      for (const fieldId of [checkboxFieldId, singleSelectFieldId, userFieldId, createdByFieldId]) {
        const query = {
          fieldKeyType: FieldKeyType.Id,
          cellFormat: CellFormat.Json,
          groupBy: [{ fieldId, order: SortFunc.Asc }],
          projection: [fieldId],
        };
        const v1 = await getRecordsFromVersion(table.id, false, query);
        const v2 = await getRecordsFromVersion(table.id, true, query);

        expect(v2.extra).toEqual(v1.extra);
      }

      const lastModifiedByGroups = await getRecordsFromVersion(table.id, true, {
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Json,
        groupBy: [{ fieldId: lastModifiedByFieldId, order: SortFunc.Asc }],
        includeQueryExtra: true,
      });
      expect(lastModifiedByGroups.extra?.groupPoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: expect.objectContaining({
              id: globalThis.testConfig.userId,
              title: globalThis.testConfig.userName,
            }),
          }),
        ])
      );

      const userGroups = await getRecordsFromVersion(table.id, false, {
        fieldKeyType: FieldKeyType.Id,
        groupBy: [{ fieldId: userFieldId, order: SortFunc.Asc }],
        includeQueryExtra: true,
      });
      expect(userGroups.extra?.groupPoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: expect.objectContaining({
              id: globalThis.testConfig.userId,
              title: globalThis.testConfig.userName,
              avatarUrl: expect.any(String),
            }),
          }),
        ])
      );
    } finally {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  it('matches attachment, link, lookup, rollup, and button presentation', async () => {
    let foreignTable: ITableFullVo | undefined;
    let table: ITableFullVo | undefined;
    try {
      foreignTable = await createTable(baseId, {
        name: `record-presentation-foreign-${Date.now()}`,
        fields: [
          {
            id: foreignNameFieldId,
            name: 'Company',
            type: FieldType.SingleLineText,
            isPrimary: true,
          },
          {
            id: foreignRevenueFieldId,
            name: 'Revenue',
            type: FieldType.Number,
            options: {
              formatting: {
                type: NumberFormattingType.Decimal,
                precision: 2,
              },
            },
          },
          {
            id: foreignAttachmentFieldId,
            name: 'Documents',
            type: FieldType.Attachment,
          },
        ],
        records: [
          {
            fields: {
              Company: 'Acme',
              Revenue: 123.45,
            },
          },
        ],
      } as unknown as ICreateTableRo);

      table = await createTable(baseId, {
        name: `record-presentation-structured-${Date.now()}`,
        fields: [
          {
            id: primaryFieldId,
            name: 'Name',
            type: FieldType.SingleLineText,
            isPrimary: true,
          },
          {
            id: attachmentFieldId,
            name: 'Files',
            type: FieldType.Attachment,
          },
          {
            id: buttonFieldId,
            name: 'Action',
            type: FieldType.Button,
            options: {
              label: 'Run',
              color: 'teal',
              maxCount: 3,
              resetCount: true,
            },
          },
        ],
        records: [],
      } as unknown as ICreateTableRo);

      await createField(table.id, {
        id: linkFieldId,
        name: 'Company',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignNameFieldId,
        },
      });
      await createField(table.id, {
        id: lookupFieldId,
        name: 'Company Name',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignNameFieldId,
        },
      });
      await createField(table.id, {
        id: attachmentLookupFieldId,
        name: 'Company Documents',
        type: FieldType.Attachment,
        isLookup: true,
        lookupOptions: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignAttachmentFieldId,
        },
      });
      await createField(table.id, {
        id: rollupFieldId,
        name: 'Company Revenue',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
          timeZone: 'UTC',
        },
        lookupOptions: {
          linkFieldId,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignRevenueFieldId,
        },
      });
      await createField(table.id, {
        id: multipleLinkFieldId,
        name: 'Related Companies',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignNameFieldId,
        },
      });
      await createField(table.id, {
        id: conditionalLookupFieldId,
        name: 'High Revenue Companies',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignNameFieldId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignRevenueFieldId,
                operator: 'isGreater',
                value: 100,
              },
            ],
          },
        },
      });
      await createField(table.id, {
        id: conditionalAttachmentLookupFieldId,
        name: 'High Revenue Documents',
        type: FieldType.Attachment,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignAttachmentFieldId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignRevenueFieldId,
                operator: 'isGreater',
                value: 100,
              },
            ],
          },
        },
      });
      await createField(table.id, {
        id: conditionalRollupFieldId,
        name: 'High Revenue Total',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreignTable.id,
          lookupFieldId: foreignRevenueFieldId,
          expression: 'sum({values})',
          timeZone: 'UTC',
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignRevenueFieldId,
                operator: 'isGreater',
                value: 100,
              },
            ],
          },
        },
      });

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [primaryFieldId]: 'Structured row',
              [linkFieldId]: {
                id: foreignTable.records[0]!.id,
                title: 'Acme',
              },
              [multipleLinkFieldId]: [
                {
                  id: foreignTable.records[0]!.id,
                  title: 'Acme',
                },
              ],
            },
          },
        ],
      });
      await uploadAttachment(
        table.id,
        created.records[0]!.id,
        attachmentFieldId,
        fs.createReadStream(attachmentFixturePath),
        { filename: 'presentation.txt' }
      );
      await uploadAttachment(
        foreignTable.id,
        foreignTable.records[0]!.id,
        foreignAttachmentFieldId,
        fs.createReadStream(attachmentFixturePath),
        { filename: 'foreign-presentation.txt' }
      );
      await updateRecordByApi(
        foreignTable.id,
        foreignTable.records[0]!.id,
        foreignRevenueFieldId,
        124.5
      );

      const jsonQuery = {
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Json,
      };
      const v1Json = await getRecordsFromVersion(table.id, false, jsonQuery);
      const v2Json = await getRecordsFromVersion(table.id, true, jsonQuery);
      expect(v2Json.records).toEqual(v1Json.records);
      expect(v1Json.records[0]?.fields[attachmentFieldId]).toEqual([
        expect.objectContaining({
          name: 'presentation.txt',
          token: expect.any(String),
          presignedUrl: expect.any(String),
        }),
      ]);
      expect(v1Json.records[0]?.fields[linkFieldId]).toEqual({
        id: foreignTable.records[0]!.id,
        title: 'Acme',
      });
      expect(v1Json.records[0]?.fields[multipleLinkFieldId]).toEqual([
        {
          id: foreignTable.records[0]!.id,
          title: 'Acme',
        },
      ]);
      expect(v1Json.records[0]?.fields[lookupFieldId]).toBe('Acme');
      expect(v1Json.records[0]?.fields[attachmentLookupFieldId]).toEqual([
        expect.objectContaining({
          name: 'foreign-presentation.txt',
          presignedUrl: expect.any(String),
        }),
      ]);
      expect(v1Json.records[0]?.fields[rollupFieldId]).toBe(124.5);
      expect(v1Json.records[0]?.fields[conditionalLookupFieldId]).toEqual(['Acme']);
      expect(v1Json.records[0]?.fields[conditionalAttachmentLookupFieldId]).toEqual([
        expect.objectContaining({
          name: 'foreign-presentation.txt',
          presignedUrl: expect.any(String),
        }),
      ]);
      expect(v1Json.records[0]?.fields[conditionalRollupFieldId]).toBe(124.5);
      expect(v1Json.records[0]?.fields).not.toHaveProperty(buttonFieldId);

      for (const fieldId of [
        attachmentFieldId,
        attachmentLookupFieldId,
        conditionalAttachmentLookupFieldId,
        linkFieldId,
      ]) {
        const groupQuery = {
          fieldKeyType: FieldKeyType.Id,
          cellFormat: CellFormat.Json,
          groupBy: [{ fieldId, order: SortFunc.Asc }],
          includeQueryExtra: true,
        };
        const v1Group = await getRecordsFromVersion(table.id, false, groupQuery);
        const v2Group = await getRecordsFromVersion(table.id, true, groupQuery);
        expect(v2Group.extra).toEqual(v1Group.extra);
      }

      const textQuery = {
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Text,
      };
      const v1Text = await getRecordsFromVersion(table.id, false, textQuery);
      const v2Text = await getRecordsFromVersion(table.id, true, textQuery);
      expect(v2Text.records).toEqual(v1Text.records);
      expect(v1Text.records[0]?.fields[attachmentFieldId]).toMatch(/^presentation\.txt \([^)]+\)$/);
      expect(v1Text.records[0]?.fields[linkFieldId]).toBe('Acme');
      expect(v1Text.records[0]?.fields[multipleLinkFieldId]).toBe('Acme');
      expect(v1Text.records[0]?.fields[lookupFieldId]).toBe('Acme');
      expect(v1Text.records[0]?.fields[rollupFieldId]).toBe('124.50');
      expect(v1Text.records[0]?.fields[conditionalLookupFieldId]).toBe('Acme');
      expect(v1Text.records[0]?.fields[conditionalRollupFieldId]).toBe('124.50');
      expect(v1Text.records[0]?.fields).not.toHaveProperty(buttonFieldId);
    } finally {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
      if (foreignTable) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  }, 30_000);
});
