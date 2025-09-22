/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import {
  Colors,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  RatingIcon,
  Relationship,
  generateFieldId,
} from '@teable/core';
import type { ICreateRecordsVo, ITableFullVo } from '@teable/openapi';
import { getRecord as getRecordApi } from '@teable/openapi';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import {
  convertField,
  createField,
  createRecords,
  createTable,
  deleteField,
  deleteRecords,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';
import { seeding } from './utils/record-mock';

interface ILargeTableContext {
  app: INestApplication;
  mainTable: ITableFullVo;
  linkedTable: ITableFullVo;
  linkFieldId: string;
  lookupFieldId: string;
  rollupFieldId: string;
  formulaFieldId: string;
  sampleRecordId: string;
  linkedRecordIds: string[];
  cleanup: () => Promise<void>;
}

const baseId = globalThis.testConfig.baseId;
const TARGET_RECORDS = 10_000;
const INSERT_BATCH_SIZE = 200;
const INITIAL_LINKED_RECORDS = 50;
const LINK_SETUP_BATCH = 40;

const textField = {
  id: generateFieldId(),
  name: 'Bench Text',
  type: FieldType.SingleLineText,
} satisfies IFieldRo;

const numberField = {
  id: generateFieldId(),
  name: 'Bench Number',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 0 },
  },
} satisfies IFieldRo;

const longTextField = {
  id: generateFieldId(),
  name: 'Bench Long Text',
  type: FieldType.LongText,
} satisfies IFieldRo;

const checkboxField = {
  id: generateFieldId(),
  name: 'Bench Checkbox',
  type: FieldType.Checkbox,
} satisfies IFieldRo;

const dateField = {
  id: generateFieldId(),
  name: 'Bench Date',
  type: FieldType.Date,
} satisfies IFieldRo;

const singleSelectField = {
  id: generateFieldId(),
  name: 'Bench Select',
  type: FieldType.SingleSelect,
  options: {
    choices: [
      { name: 'alpha', color: Colors.Blue },
      { name: 'beta', color: Colors.Green },
      { name: 'gamma', color: Colors.Red },
    ],
  },
} satisfies IFieldRo;

const multiSelectField = {
  id: generateFieldId(),
  name: 'Bench Multi',
  type: FieldType.MultipleSelect,
  options: {
    choices: [
      { name: 'red', color: Colors.Red },
      { name: 'green', color: Colors.Green },
      { name: 'blue', color: Colors.Blue },
      { name: 'orange', color: Colors.Orange },
    ],
  },
} satisfies IFieldRo;

const textFieldB = {
  id: generateFieldId(),
  name: 'Bench Text B',
  type: FieldType.SingleLineText,
} satisfies IFieldRo;

const numberFieldB = {
  id: generateFieldId(),
  name: 'Bench Number B',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 2 },
  },
} satisfies IFieldRo;

const longTextFieldB = {
  id: generateFieldId(),
  name: 'Bench Long Text B',
  type: FieldType.LongText,
} satisfies IFieldRo;

const textFieldC = {
  id: generateFieldId(),
  name: 'Bench Text C',
  type: FieldType.SingleLineText,
} satisfies IFieldRo;

const numberFieldC = {
  id: generateFieldId(),
  name: 'Bench Number C',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 3 },
  },
} satisfies IFieldRo;

const dateFieldB = {
  id: generateFieldId(),
  name: 'Bench Date B',
  type: FieldType.Date,
} satisfies IFieldRo;

const singleSelectFieldB = {
  id: generateFieldId(),
  name: 'Bench Select B',
  type: FieldType.SingleSelect,
  options: {
    choices: [
      { name: 'spring', color: Colors.Green },
      { name: 'summer', color: Colors.Orange },
      { name: 'winter', color: Colors.Blue },
    ],
  },
} satisfies IFieldRo;

const multiSelectFieldB = {
  id: generateFieldId(),
  name: 'Bench Multi B',
  type: FieldType.MultipleSelect,
  options: {
    choices: [
      { name: 'north', color: Colors.Blue },
      { name: 'south', color: Colors.Green },
      { name: 'east', color: Colors.Yellow },
      { name: 'west', color: Colors.Red },
    ],
  },
} satisfies IFieldRo;

const ratingField = {
  id: generateFieldId(),
  name: 'Bench Rating',
  type: FieldType.Rating,
  options: {
    icon: RatingIcon.Star,
    color: Colors.YellowBright,
    max: 5,
  },
} satisfies IFieldRo;

const baseFields: IFieldRo[] = [
  textField,
  numberField,
  longTextField,
  checkboxField,
  dateField,
  singleSelectField,
  multiSelectField,
  textFieldB,
  numberFieldB,
  longTextFieldB,
  textFieldC,
  numberFieldC,
  dateFieldB,
  singleSelectFieldB,
  multiSelectFieldB,
  ratingField,
];

const linkedNameField = {
  id: generateFieldId(),
  name: 'Linked Name',
  type: FieldType.SingleLineText,
} satisfies IFieldRo;

const linkedValueField = {
  id: generateFieldId(),
  name: 'Linked Value',
  type: FieldType.Number,
  options: {
    formatting: { type: NumberFormattingType.Decimal, precision: 0 },
  },
} satisfies IFieldRo;

const LINK_FIELD_NAME = 'Benchmark Links';
const LOOKUP_FIELD_NAME = 'Benchmark Lookup';
const ROLLUP_FIELD_NAME = 'Benchmark Rollup';
const FORMULA_FIELD_NAME = 'Benchmark Formula';
const CONTEXT_NOT_INITIALIZED_MESSAGE = 'Large table context is not initialized';

let contextPromise: Promise<ILargeTableContext> | null = null;

async function ensureLargeTableContext(): Promise<ILargeTableContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const appCtx = await initApp();
      const app = appCtx.app;

      const linkedTable = await createTable(baseId, {
        name: 'benchmark-linked',
        fields: [linkedNameField, linkedValueField],
        records: Array.from({ length: INITIAL_LINKED_RECORDS }, (_, index) => ({
          fields: {
            [linkedNameField.name]: `Linked ${index + 1}`,
            [linkedValueField.name]: (index % 10) + 1,
          },
        })),
      });

      const linkedRecordIds = linkedTable.records?.map((record) => record.id) ?? [];

      const mainTable = await createTable(baseId, {
        name: 'benchmark-main',
        fields: baseFields,
      });

      await seeding(mainTable.id, TARGET_RECORDS);

      const linkField = await createField(mainTable.id, {
        id: generateFieldId(),
        name: LINK_FIELD_NAME,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: linkedTable.id,
        },
      });

      const lookupField = await createField(mainTable.id, {
        id: generateFieldId(),
        name: LOOKUP_FIELD_NAME,
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: linkedTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: linkedValueField.id,
        },
      });

      const rollupField = await createField(mainTable.id, {
        id: generateFieldId(),
        name: ROLLUP_FIELD_NAME,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: linkedTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: linkedValueField.id,
        },
      });

      const formulaField = await createField(mainTable.id, {
        id: generateFieldId(),
        name: FORMULA_FIELD_NAME,
        type: FieldType.Formula,
        options: {
          expression: `({${numberField.id}}) + ({${numberFieldB.id}})`,
        },
      });

      const seededRecords = await getRecords(mainTable.id, {
        fieldKeyType: FieldKeyType.Id,
        take: LINK_SETUP_BATCH,
      });

      const linkTargets = linkedRecordIds.length
        ? linkedRecordIds
        : linkedTable.records.map((record) => record.id);

      if (!linkTargets.length) {
        throw new Error('Benchmark setup failed: no linked records available.');
      }

      await Promise.all(
        seededRecords.records.map((record, index) => {
          const value = [
            { id: linkTargets[index % linkTargets.length] },
            { id: linkTargets[(index + 1) % linkTargets.length] },
          ];

          return updateRecord(mainTable.id, record.id, {
            fieldKeyType: FieldKeyType.Id,
            record: {
              fields: {
                [linkField.id]: value,
              },
            },
          });
        })
      );

      const sampleRecordId = seededRecords.records[0]?.id;

      if (!sampleRecordId) {
        throw new Error('Benchmark setup failed: missing sample record.');
      }

      const cleanup = async () => {
        try {
          await permanentDeleteTable(baseId, mainTable.id);
        } catch (error) {
          console.warn('[large-table] cleanup main table failed', error);
        }
        try {
          await permanentDeleteTable(baseId, linkedTable.id);
        } catch (error) {
          console.warn('[large-table] cleanup linked table failed', error);
        }
        await app.close();
      };

      return {
        app,
        mainTable,
        linkedTable,
        linkFieldId: linkField.id,
        lookupFieldId: lookupField.id,
        rollupFieldId: rollupField.id,
        formulaFieldId: formulaField.id,
        sampleRecordId,
        linkedRecordIds: linkTargets,
        cleanup,
      };
    })();
  }

  return contextPromise;
}

describe('Large table operations timing (e2e)', () => {
  let context: ILargeTableContext | undefined;

  beforeAll(async () => {
    context = await ensureLargeTableContext();
  });

  afterAll(async () => {
    if (context) {
      await context.cleanup();
    }
  });

  test(
    'convert dependent columns (timed)',
    async () => {
      const activeContext = context;
      if (!activeContext) {
        throw new Error(CONTEXT_NOT_INITIALIZED_MESSAGE);
      }

      const timings: Record<string, number> = {};
      const memoryStats: Record<string, number> = {};

      const captureMemory = (label: string) => {
        const stats = process.memoryUsage();
        const rssMB = stats.rss / 1024 / 1024;
        memoryStats[label] = Number(rssMB.toFixed(2));
      };

      const measure = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
        const start = performance.now();
        captureMemory(`${label}:start`);
        try {
          return await fn();
        } finally {
          timings[label] = performance.now() - start;
          captureMemory(`${label}:end`);
        }
      };

      const stringField = await measure('convertToText', () =>
        convertField(activeContext.mainTable.id, numberField.id, {
          type: FieldType.SingleLineText,
        })
      );
      expect(stringField.type).toBe(FieldType.SingleLineText);

      const numberAgain = await measure('convertToNumber', () =>
        convertField(activeContext.mainTable.id, numberField.id, {
          type: FieldType.Number,
          options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
        })
      );
      expect(numberAgain.type).toBe(FieldType.Number);

      const finalRecord = await measure('fetchRecord', () =>
        getRecordApi(activeContext.mainTable.id, activeContext.sampleRecordId, {
          fieldKeyType: FieldKeyType.Id,
        }).then((res) => res.data)
      );

      const finalFields = finalRecord.fields ?? {};
      const requiredFieldIds = [activeContext.lookupFieldId, activeContext.rollupFieldId];

      for (const fieldId of requiredFieldIds) {
        expect(finalFields[fieldId]).toBeDefined();
      }

      const total = Object.values(timings).reduce((sum, current) => sum + current, 0);
      console.info('[large-table] timings (ms):', {
        ...Object.fromEntries(
          Object.entries(timings).map(([label, value]) => [label, Number(value.toFixed(2))])
        ),
        total: Number(total.toFixed(2)),
      });

      console.info('[large-table] memory (MB):', memoryStats);
    },
    {
      timeout: 300_000,
    }
  );

  test(
    'create formula column (timed)',
    async () => {
      const activeContext = context;
      if (!activeContext) {
        throw new Error(CONTEXT_NOT_INITIALIZED_MESSAGE);
      }

      const start = performance.now();
      const dynamicFormula = await createField(activeContext.mainTable.id, {
        id: generateFieldId(),
        name: `Timed Formula ${Date.now()}`,
        type: FieldType.Formula,
        options: {
          expression: `({${numberField.id}}) + ({${numberFieldB.id}})`,
        },
      });

      const elapsed = performance.now() - start;
      console.info('[large-table] create formula field timing (ms):', Number(elapsed.toFixed(2)));

      expect(dynamicFormula.type).toBe(FieldType.Formula);

      await deleteField(activeContext.mainTable.id, dynamicFormula.id);
    },
    {
      timeout: 300_000,
    }
  );

  test(
    `create ${INSERT_BATCH_SIZE} records batch (timed)`,
    async () => {
      if (!context) {
        throw new Error(CONTEXT_NOT_INITIALIZED_MESSAGE);
      }

      const linkPool = context.linkedRecordIds.length
        ? context.linkedRecordIds
        : context.linkedTable.records.map((record) => record.id);

      if (!linkPool.length) {
        throw new Error('No linked records available for benchmark insert payload');
      }

      const now = Date.now();
      const recordsPayload = Array.from({ length: INSERT_BATCH_SIZE }, (_, index) => {
        const linkId = linkPool[index % linkPool.length] ?? null;
        return {
          fields: {
            [textField.id]: `Bench row ${now}-${index}`,
            [numberField.id]: index,
            ...(linkId ? { [context!.linkFieldId]: [{ id: linkId }] } : {}),
          },
        };
      });

      const created = await getTimedRecordsCreation(context.mainTable.id, recordsPayload);
      expect(created.records.length).toBe(INSERT_BATCH_SIZE);

      const createdIds = created.records.map((record) => record.id);
      await deleteRecords(context.mainTable.id, createdIds);
    },
    {
      timeout: 300_000,
    }
  );
});

async function getTimedRecordsCreation(
  tableId: string,
  recordsPayload: Array<{ fields: Record<string, unknown> }>
): Promise<ICreateRecordsVo> {
  const start = performance.now();
  const created = await createRecords(tableId, {
    fieldKeyType: FieldKeyType.Id,
    typecast: true,
    records: recordsPayload,
  });

  const elapsed = performance.now() - start;
  console.info('[large-table] createRecords batch timing (ms):', Number(elapsed.toFixed(2)));

  return created;
}
