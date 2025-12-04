/* eslint-disable regexp/no-super-linear-backtracking */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import {
  FieldType,
  FieldKeyType,
  TableDomain,
  TimeFormatting,
  Relationship,
  DbFieldType,
} from '@teable/core';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { createFieldInstanceByVo } from '../src/features/field/model/factory';
import type { ISelectFormulaConversionContext } from '../src/features/record/query-builder/sql-conversion.visitor';
import {
  createField,
  createRecords,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Formula metadata-aware coercion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dbProvider: IDbProvider;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
  });

  afterAll(async () => {
    await app.close();
  });

  const parseSchemaAndTable = (dbTableName: string): [string, string] => {
    const match = dbTableName.match(/^"?(.*?)"?\."?(.*?)"?$/);
    if (match) {
      return [match[1], match[2]];
    }
    const parts = dbTableName.split('.');
    return [parts[0] ?? dbTableName, parts[1] ?? dbTableName];
  };

  describe('generated columns', () => {
    it('avoids regex sanitizers for numeric operands', async () => {
      const table: ITableFullVo = await createTable(baseId, {
        name: 'formula_metadata_generated',
        fields: [
          {
            name: 'Value',
            type: FieldType.Number,
          },
        ],
      });

      try {
        const valueField = table.fields.find((field) => field.name === 'Value') as IFieldVo;
        const doubleField = (await createField(table.id, {
          name: 'Double',
          type: FieldType.Formula,
          options: {
            expression: `{${valueField.id}} + {${valueField.id}}`,
          },
        })) as IFieldVo;

        const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
          where: { id: table.id },
          select: { dbTableName: true },
        });
        const [schema, rawTableName] = parseSchemaAndTable(tableMeta.dbTableName);
        const rows = await prisma.$queryRaw<
          { generation_expression: string }[]
        >`SELECT generation_expression
          FROM information_schema.columns
          WHERE table_schema = ${schema}
            AND table_name = ${rawTableName}
            AND column_name = ${doubleField.dbFieldName}`;

        expect(rows[0]?.generation_expression).toBeNull();
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });
  });

  describe('select query conversion', () => {
    it('emits direct casts for numeric operands', async () => {
      const seedFields: IFieldRo[] = [
        { name: 'Revenue', type: FieldType.Number },
        { name: 'Cost', type: FieldType.Number },
      ];
      const table: ITableFullVo = await createTable(baseId, {
        name: 'formula_metadata_select',
        fields: seedFields,
      });

      try {
        const fieldMap = new Map(table.fields.map((field) => [field.name, field as IFieldVo]));
        const revenueField = fieldMap.get('Revenue')!;
        const costField = fieldMap.get('Cost')!;
        const expression = `{${revenueField.id}} - {${costField.id}}`;

        const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
          where: { id: table.id },
          select: { dbTableName: true },
        });

        const tableDomain = new TableDomain({
          id: table.id,
          name: table.name,
          dbTableName: tableMeta.dbTableName,
          lastModifiedTime: table.lastModifiedTime ?? new Date().toISOString(),
          fields: [revenueField, costField].map((field) => createFieldInstanceByVo(field)),
        });

        const tableAlias = 'main';
        const selectionEntries = [revenueField, costField].map((field) => [
          field.id,
          `"${tableAlias}"."${field.dbFieldName}"`,
        ]) as [string, string][];
        const context: ISelectFormulaConversionContext = {
          table: tableDomain,
          selectionMap: new Map(selectionEntries),
          tableAlias,
          timeZone: 'UTC',
          preferRawFieldReferences: true,
        };

        const sql = dbProvider.convertFormulaToSelectQuery(expression, context);
        expect(sql).not.toContain('REGEXP_REPLACE');
        expect(sql).toContain('::double precision');
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('emits boolean shortcuts for checkbox IF conditions', async () => {
      const seedFields: IFieldRo[] = [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Enabled', type: FieldType.Checkbox },
      ];
      const table: ITableFullVo = await createTable(baseId, {
        name: 'formula_metadata_boolean_select',
        fields: seedFields,
      });

      try {
        const flagField = table.fields.find((field) => field.name === 'Enabled') as IFieldVo;
        const expression = `IF({${flagField.id}}, 'on', 'off')`;

        const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
          where: { id: table.id },
          select: { dbTableName: true },
        });

        const tableDomain = new TableDomain({
          id: table.id,
          name: table.name,
          dbTableName: tableMeta.dbTableName,
          lastModifiedTime: table.lastModifiedTime ?? new Date().toISOString(),
          fields: [flagField].map((field) => createFieldInstanceByVo(field)),
        });

        const tableAlias = 'main';
        const selectionEntries = [[flagField.id, `"${tableAlias}"."${flagField.dbFieldName}"`]] as [
          string,
          string,
        ][];
        const context: ISelectFormulaConversionContext = {
          table: tableDomain,
          selectionMap: new Map(selectionEntries),
          tableAlias,
          timeZone: 'UTC',
          preferRawFieldReferences: true,
        };

        const sql = dbProvider.convertFormulaToSelectQuery(expression, context);
        expect(sql).toContain(`COALESCE(("${tableAlias}"."${flagField.dbFieldName}"), FALSE)`);
        expect(sql).not.toContain('pg_typeof');
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('emits numeric shortcuts for IF conditions referencing number fields', async () => {
      const seedFields: IFieldRo[] = [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Quantity', type: FieldType.Number },
      ];
      const table: ITableFullVo = await createTable(baseId, {
        name: 'formula_metadata_numeric_if_select',
        fields: seedFields,
      });

      try {
        const qtyField = table.fields.find((field) => field.name === 'Quantity') as IFieldVo;
        const expression = `IF({${qtyField.id}}, 'in stock', 'out')`;

        const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
          where: { id: table.id },
          select: { dbTableName: true },
        });

        const tableDomain = new TableDomain({
          id: table.id,
          name: table.name,
          dbTableName: tableMeta.dbTableName,
          lastModifiedTime: table.lastModifiedTime ?? new Date().toISOString(),
          fields: [qtyField].map((field) => createFieldInstanceByVo(field)),
        });

        const tableAlias = 'main';
        const selectionEntries = [[qtyField.id, `"${tableAlias}"."${qtyField.dbFieldName}"`]] as [
          string,
          string,
        ][];
        const context: ISelectFormulaConversionContext = {
          table: tableDomain,
          selectionMap: new Map(selectionEntries),
          tableAlias,
          timeZone: 'UTC',
          preferRawFieldReferences: true,
        };

        const sql = dbProvider.convertFormulaToSelectQuery(expression, context);
        expect(sql).toContain(
          `COALESCE(("${tableAlias}"."${qtyField.dbFieldName}")::double precision, 0)`
        );
        expect(sql).not.toContain('REGEXP_REPLACE');
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('does not wrap scalar lookup/rollup references in multi-value guards', () => {
      const tableAlias = 'main';

      const linkField = createFieldInstanceByVo({
        id: 'fldLink',
        name: 'Vehicle',
        type: FieldType.Link,
        dbFieldName: 'Vehicles',
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: false,
        options: { relationship: Relationship.ManyOne },
      } as unknown as IFieldVo);

      const intervalField = createFieldInstanceByVo({
        id: 'fldInterval',
        name: 'Interval (Hrs)',
        type: FieldType.Number,
        cellValueType: 'number',
        dbFieldName: 'Interval_Hrs',
        dbFieldType: DbFieldType.Real,
      } as unknown as IFieldVo);

      const lookupRollupField = createFieldInstanceByVo({
        id: 'fldRoll',
        name: 'Current Hrs',
        type: FieldType.Rollup,
        cellValueType: 'number',
        dbFieldName: `lookup_fldRoll`,
        dbFieldType: DbFieldType.Real,
        isLookup: true,
        isMultipleCellValue: false,
        lookupOptions: {
          linkFieldId: linkField.id,
          lookupFieldId: 'fldSrc',
          relationship: Relationship.ManyOne,
        },
        options: { expression: 'max({values})' },
      } as unknown as IFieldVo);

      const tableDomain = new TableDomain({
        id: 'tblMetaLookup',
        name: 'meta_lookup_scalar',
        dbTableName: '"public"."meta_lookup_scalar"',
        lastModifiedTime: new Date().toISOString(),
        fields: [intervalField, lookupRollupField, linkField],
      });

      const selectionEntries: [string, string][] = [
        [intervalField.id, `"${tableAlias}"."${intervalField.dbFieldName}"`],
        [lookupRollupField.id, `"${tableAlias}"."${lookupRollupField.dbFieldName}"`],
      ];

      const context: ISelectFormulaConversionContext = {
        table: tableDomain,
        selectionMap: new Map(selectionEntries),
        tableAlias,
        timeZone: 'UTC',
        preferRawFieldReferences: true,
      };

      const expression = `IF({${intervalField.id}} > 0, {${intervalField.id}} + {${lookupRollupField.id}}, 0)`;
      const sql = dbProvider.convertFormulaToSelectQuery(expression, context);

      expect(sql).not.toContain('pg_typeof');
      expect(sql).not.toContain('jsonb_build_array');
      expect(sql).toContain(`"${tableAlias}"."${lookupRollupField.dbFieldName}"`);
      expect(sql).toContain('::double precision');
    });

    it('treats BLANK() as NULL for select queries with mixed branch types', async () => {
      const seedFields: IFieldRo[] = [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
        {
          name: 'Due Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: TimeFormatting.Hour24,
              timeZone: 'UTC',
            },
          },
        },
      ];

      const table: ITableFullVo = await createTable(baseId, {
        name: 'formula_metadata_blank_select',
        fields: seedFields,
      });

      try {
        const fieldMap = new Map<string, IFieldVo>(
          table.fields.map((field) => [field.name, field as IFieldVo])
        );
        const titleField = fieldMap.get('Title')!;
        const amountField = fieldMap.get('Amount')!;
        const dueField = fieldMap.get('Due Date')!;

        const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
          where: { id: table.id },
          select: { dbTableName: true },
        });

        const tableDomain = new TableDomain({
          id: table.id,
          name: table.name,
          dbTableName: tableMeta.dbTableName,
          lastModifiedTime: table.lastModifiedTime ?? new Date().toISOString(),
          fields: [titleField, amountField, dueField].map((field) =>
            createFieldInstanceByVo(field)
          ),
        });

        const tableAlias = 'main';
        const selectionEntries = [titleField, amountField, dueField].map((field) => [
          field.id,
          `"${tableAlias}"."${field.dbFieldName}"`,
        ]) as [string, string][];

        const context: ISelectFormulaConversionContext = {
          table: tableDomain,
          selectionMap: new Map(selectionEntries),
          tableAlias,
          timeZone: 'UTC',
          preferRawFieldReferences: true,
        };

        const blankSql = dbProvider.convertFormulaToSelectQuery('BLANK()', context) as string;
        expect(blankSql.trim()).toBe('NULL');

        const branchAssertions: Array<{ expression: string; expectedBranch: string }> = [
          {
            expression: `IF(TRUE, BLANK(), {${titleField.id}})`,
            expectedBranch: `"${tableAlias}"."${titleField.dbFieldName}"`,
          },
          {
            expression: `IF(TRUE, BLANK(), {${amountField.id}})`,
            expectedBranch: `"${tableAlias}"."${amountField.dbFieldName}"`,
          },
          {
            expression: `IF(TRUE, BLANK(), {${dueField.id}})`,
            expectedBranch: `"${tableAlias}"."${dueField.dbFieldName}"`,
          },
        ];

        for (const { expression, expectedBranch } of branchAssertions) {
          const sql = dbProvider.convertFormulaToSelectQuery(expression, context);
          expect(sql).toMatch(/THEN\s+\(?NULL/i);
          expect(sql).not.toMatch(/THEN\s+''/i);
          expect(sql).toContain(expectedBranch);
        }
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });
  });

  describe('runtime formulas', () => {
    it('concatenates typed fields without redundant casts', async () => {
      const table = await createTable(baseId, {
        name: 'formula_metadata_concat',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText },
          { name: 'Qty', type: FieldType.Number },
        ],
        records: [
          {
            fields: {
              Label: 'Widget',
              Qty: 3,
            },
          },
        ],
      });

      try {
        const fieldMap = new Map<string, IFieldVo>(
          table.fields.map((field) => [field.name, field])
        );
        const labelField = fieldMap.get('Label')!;
        const qtyField = fieldMap.get('Qty')!;

        const concatField = (await createField(table.id, {
          name: 'Label Qty',
          type: FieldType.Formula,
          options: {
            expression: `{${labelField.id}} & ' x ' & {${qtyField.id}} & '!'`,
          },
        })) as IFieldVo;

        const recordId = table.records[0].id;
        const readValue = async () => {
          const record = await getRecord(table.id, recordId);
          return record.fields?.[concatField.id];
        };

        expect(await readValue()).toBe('Widget x 3!');

        await updateRecordByApi(table.id, recordId, labelField.id, 'Gadget');
        await updateRecordByApi(table.id, recordId, qtyField.id, 1);
        expect(await readValue()).toBe('Gadget x 1!');
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('evaluates AND conditions using typed operands', async () => {
      const table = await createTable(baseId, {
        name: 'formula_metadata_logic',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Enabled', type: FieldType.Checkbox },
          { name: 'Attempts', type: FieldType.Number },
        ],
      });

      try {
        const fieldMap = new Map<string, IFieldVo>(
          table.fields.map((field) => [field.name, field])
        );
        const enabledField = fieldMap.get('Enabled')!;
        const attemptsField = fieldMap.get('Attempts')!;

        const logicField = (await createField(table.id, {
          name: 'Should Trigger',
          type: FieldType.Formula,
          options: {
            expression: `IF(AND({${enabledField.id}}, {${attemptsField.id}}), 1, 0)`,
          },
        })) as IFieldVo;

        const { records } = await createRecords(table.id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                Title: 'Row 1',
                Enabled: true,
                Attempts: 0,
              },
            },
          ],
        });

        const recordId = records[0].id;
        const readValue = async () => {
          const record = await getRecord(table.id, recordId);
          return record.fields?.[logicField.id];
        };

        expect(await readValue()).toBe(0);

        await updateRecordByApi(table.id, recordId, attemptsField.id, 2);
        expect(await readValue()).toBe(1);

        await updateRecordByApi(table.id, recordId, enabledField.id, false);
        expect(await readValue()).toBe(0);
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('keeps BLANK as null in standalone formulas and IF branches across types', async () => {
      const dueDateValue = '2025-02-02T00:00:00.000Z';
      const table = await createTable(baseId, {
        name: 'formula_blank_runtime',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          {
            name: 'Due',
            type: FieldType.Date,
            options: {
              formatting: {
                date: 'YYYY-MM-DD',
                time: TimeFormatting.Hour24,
                timeZone: 'UTC',
              },
            },
          } as IFieldRo,
        ],
      });

      try {
        const titleField = table.fields.find((field) => field.name === 'Title')!;
        const amountField = table.fields.find((field) => field.name === 'Amount')!;
        const dueField = table.fields.find((field) => field.name === 'Due')!;

        const blankField = (await createField(table.id, {
          name: 'Standalone Blank',
          type: FieldType.Formula,
          options: { expression: 'BLANK()' },
        })) as IFieldVo;

        const dateWhenTrue = (await createField(table.id, {
          name: 'Date When True',
          type: FieldType.Formula,
          options: { expression: `IF(TRUE, {${dueField.id}}, BLANK())` },
        })) as IFieldVo;

        const dateWhenFalse = (await createField(table.id, {
          name: 'Blank When False',
          type: FieldType.Formula,
          options: { expression: `IF(FALSE, {${dueField.id}}, BLANK())` },
        })) as IFieldVo;

        const numberWhenTrue = (await createField(table.id, {
          name: 'Number When True',
          type: FieldType.Formula,
          options: { expression: `IF(TRUE, {${amountField.id}}, BLANK())` },
        })) as IFieldVo;

        const numberWhenFalse = (await createField(table.id, {
          name: 'Blank When False Number',
          type: FieldType.Formula,
          options: { expression: `IF(FALSE, {${amountField.id}}, BLANK())` },
        })) as IFieldVo;

        const { records } = await createRecords(table.id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [titleField.name]: 'Row 1',
                [amountField.name]: 12,
                [dueField.name]: dueDateValue,
              },
            },
          ],
        });

        const recordId = records[0].id;

        const readValue = async (fieldId: string) => {
          const record = await getRecord(table.id, recordId);
          return record.fields?.[fieldId] ?? null;
        };

        expect(await readValue(blankField.id)).toBeNull();
        expect(await readValue(dateWhenTrue.id)).toBe(dueDateValue);
        expect(await readValue(dateWhenFalse.id)).toBeNull();
        expect(await readValue(numberWhenTrue.id)).toBe(12);
        expect(await readValue(numberWhenFalse.id)).toBeNull();
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
    });
  });
});
