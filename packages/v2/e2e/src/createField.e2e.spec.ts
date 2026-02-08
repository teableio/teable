/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldErrorResponseSchema,
  createFieldOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
} from '@teable/v2-contract-http';
import type { ITableFieldInput } from '@teable/v2-core';
import {
  CellValueType,
  ROLLUP_FUNCTIONS,
  getRollupFunctionsByCellValueType,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http createField (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let tablePrimaryFieldId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const getTableById = async (targetTableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${targetTableId}`,
      { method: 'GET' }
    );
    expect(response.status).toBe(200);
    const raw = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to get table ${targetTableId}: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.table;
  };

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const rawBody = await response.json();
    if (response.status !== 201) {
      throw new Error(`CreateTable failed: ${JSON.stringify(rawBody)}`);
    }
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
    }
    expect(response.status).toBe(201);
    return parsed.data.data.table;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const createTableResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        name: 'CreateField Table',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      }),
    });

    const rawBody = await createTableResponse.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to create seed table');
    }
    tableId = parsed.data.data.table.id;
    const primaryField = parsed.data.data.table.fields.find((field) => field.isPrimary);
    if (!primaryField) {
      throw new Error('Failed to resolve primary field');
    }
    tablePrimaryFieldId = primaryField.id;

    const foreignResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        name: 'Foreign Table',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      }),
    });
    const foreignRaw = await foreignResponse.json();
    const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
    expect(foreignParsed.success).toBe(true);
    if (!foreignParsed.success || !foreignParsed.data.ok) {
      throw new Error('Failed to create foreign table');
    }
    foreignTableId = foreignParsed.data.data.table.id;
    const foreignPrimary = foreignParsed.data.data.table.fields.find((field) => field.isPrimary);
    if (!foreignPrimary) {
      throw new Error('Failed to resolve foreign primary field');
    }
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    // Cleanup tables created by this test
    if (tableId) {
      try {
        await ctx.deleteTable(tableId);
      } catch {
        // Ignore cleanup errors
      }
    }
    if (foreignTableId) {
      try {
        await ctx.deleteTable(foreignTableId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('creates all field types with configured options', async () => {
    const numberFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    const cases = [
      {
        field: {
          type: 'singleLineText',
          id: createFieldId(),
          name: 'Title',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
          notNull: true,
          unique: true,
        },
        expect: {
          type: 'singleLineText',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
          notNull: true,
          unique: true,
        },
      },
      {
        field: {
          type: 'longText',
          id: createFieldId(),
          name: 'Notes',
          options: { defaultValue: 'Details' },
        },
        expect: {
          type: 'longText',
          options: { defaultValue: 'Details' },
        },
      },
      {
        field: {
          type: 'number',
          id: numberFieldId,
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        expect: {
          type: 'number',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
      },
      {
        field: {
          type: 'autoNumber',
          id: createFieldId(),
          name: 'Auto Number',
        },
        expect: {
          type: 'autoNumber',
          options: { expression: 'AUTO_NUMBER()' },
        },
      },
      {
        field: {
          type: 'rating',
          id: createFieldId(),
          name: 'Priority',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
        expect: {
          type: 'rating',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
      },
      {
        field: {
          type: 'singleSelect',
          id: createFieldId(),
          name: 'Status',
          options: {
            choices: [
              { id: 'opt1', name: 'Todo', color: 'blue' },
              { id: 'opt2', name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
            preventAutoNewOptions: true,
          },
        },
        expect: {
          type: 'singleSelect',
          options: {
            choices: [
              { id: 'opt1', name: 'Todo', color: 'blue' },
              { id: 'opt2', name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
            preventAutoNewOptions: true,
          },
        },
      },
      {
        field: {
          type: 'multipleSelect',
          id: createFieldId(),
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
        expect: {
          type: 'multipleSelect',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
      },
      {
        field: {
          type: 'checkbox',
          id: createFieldId(),
          name: 'Approved',
          options: { defaultValue: true },
        },
        expect: {
          type: 'checkbox',
          options: { defaultValue: true },
        },
      },
      {
        field: {
          type: 'attachment',
          id: createFieldId(),
          name: 'Files',
        },
        expect: {
          type: 'attachment',
          options: {},
        },
      },
      {
        field: {
          type: 'date',
          id: createFieldId(),
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        expect: {
          type: 'date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
      },
      {
        field: {
          type: 'createdTime',
          id: createFieldId(),
          name: 'Created Time',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
        expect: {
          type: 'createdTime',
          options: {
            expression: 'CREATED_TIME()',
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
      },
      {
        field: {
          type: 'lastModifiedTime',
          id: createFieldId(),
          name: 'Last Modified Time',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            trackedFieldIds: [numberFieldId],
          },
        },
        expect: {
          type: 'lastModifiedTime',
          options: {
            expression: 'LAST_MODIFIED_TIME()',
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            trackedFieldIds: [numberFieldId],
          },
        },
      },
      {
        field: {
          type: 'user',
          id: createFieldId(),
          name: 'Owner',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
        expect: {
          type: 'user',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
      },
      {
        field: {
          type: 'createdBy',
          id: createFieldId(),
          name: 'Created By',
        },
        expect: {
          type: 'createdBy',
          options: {},
        },
      },
      {
        field: {
          type: 'lastModifiedBy',
          id: createFieldId(),
          name: 'Last Modified By',
          options: {
            trackedFieldIds: [numberFieldId],
          },
        },
        expect: {
          type: 'lastModifiedBy',
          options: {
            trackedFieldIds: [numberFieldId],
          },
        },
      },
      {
        field: {
          type: 'button',
          id: createFieldId(),
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
        expect: {
          type: 'button',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
      },
      {
        field: {
          type: 'formula',
          id: formulaFieldId,
          name: 'Score',
          options: {
            expression: `{${numberFieldId}} * 2`,
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          },
        },
        expect: {
          type: 'formula',
          options: {
            expression: `{${numberFieldId}} * 2`,
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          },
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
      },
    ];

    for (const entry of cases) {
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId,
          field: entry.field,
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 200) {
        throw new Error(`CreateField failed for ${entry.field.type}: ${JSON.stringify(rawBody)}`);
      }
      expect(response.status).toBe(200);
      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const fields = parsed.data.data.table.fields;
      const created = fields.find((f) => f.id === entry.field.id);
      expect(created).toBeTruthy();
      if (!created) return;

      expect(created.type).toBe(entry.expect.type);
      if ('options' in entry.expect) {
        expect(created.options).toEqual(entry.expect.options);
      }
      if ('notNull' in entry.expect) {
        expect(created.notNull).toBe(entry.expect.notNull);
      }
      if ('unique' in entry.expect) {
        expect(created.unique).toBe(entry.expect.unique);
      }
      if (created.type === 'formula') {
        expect(created.cellValueType).toBe(entry.expect.cellValueType);
        expect(created.isMultipleCellValue).toBe(entry.expect.isMultipleCellValue);
      }
    }
  });

  it('rejects notNull/unique for computed fields', async () => {
    const notNullResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          id: createFieldId(),
          name: 'Computed NotNull',
          notNull: true,
          options: { expression: '1' },
        },
      }),
    });
    const notNullRaw = await notNullResponse.json();
    expect(notNullResponse.status).toBe(400);
    const notNullParsed = createFieldErrorResponseSchema.safeParse(notNullRaw);
    expect(notNullParsed.success).toBe(true);
    if (notNullParsed.success) {
      expect(notNullParsed.data.ok).toBe(false);
      expect(notNullParsed.data.error.message).toContain('notNull');
    }

    const uniqueResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          id: createFieldId(),
          name: 'Computed Unique',
          unique: true,
          options: { expression: '2' },
        },
      }),
    });
    const uniqueRaw = await uniqueResponse.json();
    expect(uniqueResponse.status).toBe(400);
    const uniqueParsed = createFieldErrorResponseSchema.safeParse(uniqueRaw);
    expect(uniqueParsed.success).toBe(true);
    if (uniqueParsed.success) {
      expect(uniqueParsed.data.ok).toBe(false);
      expect(uniqueParsed.data.error.message).toContain('unique');
    }
  });

  describe('link fields', () => {
    const relationshipCases = [
      { relationship: 'oneOne', symmetricRelationship: 'oneOne' },
      { relationship: 'manyMany', symmetricRelationship: 'manyMany' },
      { relationship: 'oneMany', symmetricRelationship: 'manyOne' },
      { relationship: 'manyOne', symmetricRelationship: 'oneMany' },
    ] as const;

    const directionCases = [
      { isOneWay: false, direction: 'two-way', expectSymmetric: true },
      { isOneWay: true, direction: 'one-way', expectSymmetric: false },
    ] as const;

    const targetCases = [{ target: 'foreign' }, { target: 'self' }] as const;

    const linkCases = targetCases.flatMap((targetCase) =>
      directionCases.flatMap((directionCase) =>
        relationshipCases.map((relationshipCase) => ({
          ...relationshipCase,
          ...directionCase,
          target: targetCase.target,
          caseLabel: `${targetCase.target}-${directionCase.direction}-${relationshipCase.relationship}`,
        }))
      )
    );

    test.each(linkCases)('creates link fields for $caseLabel', async (entry) => {
      const linkFieldId = createFieldId();
      const linkForeignTableId = entry.target === 'self' ? tableId : foreignTableId;
      const lookupFieldId = entry.target === 'self' ? tablePrimaryFieldId : foreignPrimaryFieldId;

      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'link',
            id: linkFieldId,
            name: `Link ${entry.relationship} ${entry.direction} ${entry.target} ${linkFieldId}`,
            options: {
              relationship: entry.relationship,
              foreignTableId: linkForeignTableId,
              lookupFieldId,
              isOneWay: entry.isOneWay,
            },
          },
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 200) {
        throw new Error(`CreateField failed for link: ${JSON.stringify(rawBody)}`);
      }
      expect(response.status).toBe(200);

      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((field) => field.id === linkFieldId);
      expect(created).toBeTruthy();
      if (!created || created.type !== 'link') return;
      expect(created.options.relationship).toBe(entry.relationship);
      expect(created.options.foreignTableId).toBe(linkForeignTableId);
      expect(created.options.lookupFieldId).toBe(lookupFieldId);
      expect(created.options.isOneWay ?? false).toBe(entry.isOneWay);

      const targetTableId = entry.target === 'self' ? tableId : foreignTableId;
      const targetTable = await getTableById(targetTableId);
      const symmetricLinks = targetTable.fields.filter(
        (field) => field.type === 'link' && field.options.symmetricFieldId === linkFieldId
      ) as Array<{ type: 'link'; options: { relationship: string; foreignTableId: string } }>;

      if (entry.expectSymmetric) {
        expect(symmetricLinks).toHaveLength(1);
        if (symmetricLinks.length === 0) return;
        expect(symmetricLinks[0].options.relationship).toBe(entry.symmetricRelationship);
        expect(symmetricLinks[0].options.foreignTableId).toBe(tableId);
      } else {
        expect(symmetricLinks).toHaveLength(0);
      }
    });
  });

  describe('rollup fields', () => {
    type FieldTypeLiteral = ITableFieldInput['type'];
    type LookupCellValueType = 'string' | 'number' | 'dateTime' | 'boolean';
    type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

    type LookupFieldContext = {
      rollupSourceTableId: string;
    };

    type LookupFieldSpec = {
      type: FieldTypeLiteral;
      label: string;
      id: string;
      name: string;
      cellValueType: LookupCellValueType;
      buildInput: (context: LookupFieldContext) => ITableFieldInput;
    };

    type LookupFieldFactory = () => ReadonlyArray<LookupFieldSpec>;

    const rollupSourcePrimaryFieldId = createFieldId();
    const rollupSourceNumberFieldId = createFieldId();

    const rollupForeignPrimaryFieldId = createFieldId();
    const rollupForeignLongTextFieldId = createFieldId();
    const rollupForeignNumberFieldId = createFieldId();
    const rollupForeignRatingFieldId = createFieldId();
    const rollupForeignSingleSelectFieldId = createFieldId();
    const rollupForeignMultipleSelectFieldId = createFieldId();
    const rollupForeignCheckboxFieldId = createFieldId();
    const rollupForeignAttachmentFieldId = createFieldId();
    const rollupForeignDateFieldId = createFieldId();
    const rollupForeignCreatedTimeFieldId = createFieldId();
    const rollupForeignLastModifiedTimeFieldId = createFieldId();
    const rollupForeignAutoNumberFieldId = createFieldId();
    const rollupForeignUserFieldId = createFieldId();
    const rollupForeignCreatedByFieldId = createFieldId();
    const rollupForeignLastModifiedByFieldId = createFieldId();
    const rollupForeignButtonFieldId = createFieldId();
    const rollupForeignLinkFieldId = createFieldId();
    const rollupForeignRollupFieldId = createFieldId();
    const rollupForeignFormulaNumberFieldId = createFieldId();
    const rollupForeignFormulaStringFieldId = createFieldId();
    const rollupForeignFormulaBooleanFieldId = createFieldId();
    const rollupForeignFormulaDateFieldId = createFieldId();

    const rollupHostPrimaryFieldId = createFieldId();
    const rollupHostLinkFieldId = createFieldId();

    // Map by field type to enforce exhaustive coverage when new types are added.
    const lookupFieldFactories: Record<FieldTypeLiteral, LookupFieldFactory> = {
      singleLineText: () => [
        {
          type: 'singleLineText',
          label: 'singleLineText',
          id: rollupForeignPrimaryFieldId,
          name: 'Lookup Name',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'singleLineText',
            id: rollupForeignPrimaryFieldId,
            name: 'Lookup Name',
            isPrimary: true,
          }),
        },
      ],
      longText: () => [
        {
          type: 'longText',
          label: 'longText',
          id: rollupForeignLongTextFieldId,
          name: 'Lookup Notes',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'longText',
            id: rollupForeignLongTextFieldId,
            name: 'Lookup Notes',
          }),
        },
      ],
      number: () => [
        {
          type: 'number',
          label: 'number',
          id: rollupForeignNumberFieldId,
          name: 'Lookup Amount',
          cellValueType: 'number',
          buildInput: () => ({
            type: 'number',
            id: rollupForeignNumberFieldId,
            name: 'Lookup Amount',
          }),
        },
      ],
      rating: () => [
        {
          type: 'rating',
          label: 'rating',
          id: rollupForeignRatingFieldId,
          name: 'Lookup Rating',
          cellValueType: 'number',
          buildInput: () => ({
            type: 'rating',
            id: rollupForeignRatingFieldId,
            name: 'Lookup Rating',
            options: { max: 5 },
          }),
        },
      ],
      formula: () => [
        {
          type: 'formula',
          label: 'formula:number',
          id: rollupForeignFormulaNumberFieldId,
          name: 'Formula Number',
          cellValueType: 'number',
          buildInput: () => ({
            type: 'formula',
            id: rollupForeignFormulaNumberFieldId,
            name: 'Formula Number',
            options: { expression: `{${rollupForeignNumberFieldId}}` },
          }),
        },
        {
          type: 'formula',
          label: 'formula:string',
          id: rollupForeignFormulaStringFieldId,
          name: 'Formula Text',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'formula',
            id: rollupForeignFormulaStringFieldId,
            name: 'Formula Text',
            options: { expression: `{${rollupForeignPrimaryFieldId}}` },
          }),
        },
        {
          type: 'formula',
          label: 'formula:boolean',
          id: rollupForeignFormulaBooleanFieldId,
          name: 'Formula Boolean',
          cellValueType: 'boolean',
          buildInput: () => ({
            type: 'formula',
            id: rollupForeignFormulaBooleanFieldId,
            name: 'Formula Boolean',
            options: { expression: `{${rollupForeignCheckboxFieldId}}` },
          }),
        },
        {
          type: 'formula',
          label: 'formula:dateTime',
          id: rollupForeignFormulaDateFieldId,
          name: 'Formula Date',
          cellValueType: 'dateTime',
          buildInput: () => ({
            type: 'formula',
            id: rollupForeignFormulaDateFieldId,
            name: 'Formula Date',
            options: { expression: `{${rollupForeignDateFieldId}}` },
          }),
        },
      ],
      rollup: () => [
        {
          type: 'rollup',
          label: 'rollup:number',
          id: rollupForeignRollupFieldId,
          name: 'Lookup Rollup',
          cellValueType: 'number',
          buildInput: (context) => ({
            type: 'rollup',
            id: rollupForeignRollupFieldId,
            name: 'Lookup Rollup',
            options: { expression: 'sum({values})' },
            config: {
              linkFieldId: rollupForeignLinkFieldId,
              foreignTableId: context.rollupSourceTableId,
              lookupFieldId: rollupSourceNumberFieldId,
            },
          }),
        },
      ],
      singleSelect: () => [
        {
          type: 'singleSelect',
          label: 'singleSelect',
          id: rollupForeignSingleSelectFieldId,
          name: 'Lookup Status',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'singleSelect',
            id: rollupForeignSingleSelectFieldId,
            name: 'Lookup Status',
            options: ['Todo', 'Done'],
          }),
        },
      ],
      multipleSelect: () => [
        {
          type: 'multipleSelect',
          label: 'multipleSelect',
          id: rollupForeignMultipleSelectFieldId,
          name: 'Lookup Tags',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'multipleSelect',
            id: rollupForeignMultipleSelectFieldId,
            name: 'Lookup Tags',
            options: ['Alpha', 'Beta'],
          }),
        },
      ],
      checkbox: () => [
        {
          type: 'checkbox',
          label: 'checkbox',
          id: rollupForeignCheckboxFieldId,
          name: 'Lookup Done',
          cellValueType: 'boolean',
          buildInput: () => ({
            type: 'checkbox',
            id: rollupForeignCheckboxFieldId,
            name: 'Lookup Done',
          }),
        },
      ],
      attachment: () => [
        {
          type: 'attachment',
          label: 'attachment',
          id: rollupForeignAttachmentFieldId,
          name: 'Lookup Files',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'attachment',
            id: rollupForeignAttachmentFieldId,
            name: 'Lookup Files',
          }),
        },
      ],
      date: () => [
        {
          type: 'date',
          label: 'date',
          id: rollupForeignDateFieldId,
          name: 'Lookup Date',
          cellValueType: 'dateTime',
          buildInput: () => ({
            type: 'date',
            id: rollupForeignDateFieldId,
            name: 'Lookup Date',
          }),
        },
      ],
      createdTime: () => [
        {
          type: 'createdTime',
          label: 'createdTime',
          id: rollupForeignCreatedTimeFieldId,
          name: 'Lookup Created At',
          cellValueType: 'dateTime',
          buildInput: () => ({
            type: 'createdTime',
            id: rollupForeignCreatedTimeFieldId,
            name: 'Lookup Created At',
          }),
        },
      ],
      lastModifiedTime: () => [
        {
          type: 'lastModifiedTime',
          label: 'lastModifiedTime',
          id: rollupForeignLastModifiedTimeFieldId,
          name: 'Lookup Updated At',
          cellValueType: 'dateTime',
          buildInput: () => ({
            type: 'lastModifiedTime',
            id: rollupForeignLastModifiedTimeFieldId,
            name: 'Lookup Updated At',
          }),
        },
      ],
      autoNumber: () => [
        {
          type: 'autoNumber',
          label: 'autoNumber',
          id: rollupForeignAutoNumberFieldId,
          name: 'Lookup Auto Number',
          cellValueType: 'number',
          buildInput: () => ({
            type: 'autoNumber',
            id: rollupForeignAutoNumberFieldId,
            name: 'Lookup Auto Number',
          }),
        },
      ],
      user: () => [
        {
          type: 'user',
          label: 'user',
          id: rollupForeignUserFieldId,
          name: 'Lookup Owner',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'user',
            id: rollupForeignUserFieldId,
            name: 'Lookup Owner',
            options: { isMultiple: true },
          }),
        },
      ],
      createdBy: () => [
        {
          type: 'createdBy',
          label: 'createdBy',
          id: rollupForeignCreatedByFieldId,
          name: 'Lookup Created By',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'createdBy',
            id: rollupForeignCreatedByFieldId,
            name: 'Lookup Created By',
          }),
        },
      ],
      lastModifiedBy: () => [
        {
          type: 'lastModifiedBy',
          label: 'lastModifiedBy',
          id: rollupForeignLastModifiedByFieldId,
          name: 'Lookup Last Edited By',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'lastModifiedBy',
            id: rollupForeignLastModifiedByFieldId,
            name: 'Lookup Last Edited By',
          }),
        },
      ],
      button: () => [
        {
          type: 'button',
          label: 'button',
          id: rollupForeignButtonFieldId,
          name: 'Lookup Action',
          cellValueType: 'string',
          buildInput: () => ({
            type: 'button',
            id: rollupForeignButtonFieldId,
            name: 'Lookup Action',
          }),
        },
      ],
      link: () => [
        {
          type: 'link',
          label: 'link',
          id: rollupForeignLinkFieldId,
          name: 'Lookup Link',
          cellValueType: 'string',
          buildInput: (context) => ({
            type: 'link',
            id: rollupForeignLinkFieldId,
            name: 'Lookup Link',
            options: {
              relationship: 'manyMany',
              foreignTableId: context.rollupSourceTableId,
              lookupFieldId: rollupSourcePrimaryFieldId,
            },
          }),
        },
      ],
      // Lookup fields cannot be used as rollup source (no nested lookup)
      lookup: () => [],
      // Conditional fields cannot be used as rollup source
      conditionalRollup: () => [],
      conditionalLookup: () => [],
    };

    const lookupFieldSpecs = Object.values(lookupFieldFactories).flatMap((factory) => factory());

    const rollupFunctionSupport: Record<LookupCellValueType, ReadonlySet<RollupFunction>> = {
      string: new Set(getRollupFunctionsByCellValueType(CellValueType.string())),
      number: new Set(getRollupFunctionsByCellValueType(CellValueType.number())),
      dateTime: new Set(getRollupFunctionsByCellValueType(CellValueType.dateTime())),
      boolean: new Set(getRollupFunctionsByCellValueType(CellValueType.boolean())),
    };

    const rollupCases = lookupFieldSpecs.flatMap((lookup) =>
      ROLLUP_FUNCTIONS.map((expression) => ({
        caseLabel: `${lookup.label}-${expression}`,
        lookupLabel: lookup.label,
        lookupFieldId: lookup.id,
        cellValueType: lookup.cellValueType,
        expression,
        expectOk: rollupFunctionSupport[lookup.cellValueType].has(expression),
      }))
    );

    let rollupHostTableId: string;
    let rollupForeignTableId: string;

    beforeAll(async () => {
      const sourceTable = await createTable({
        baseId: ctx.baseId,
        name: 'Rollup Source',
        fields: [
          {
            type: 'singleLineText',
            id: rollupSourcePrimaryFieldId,
            name: 'Name',
            isPrimary: true,
          },
          { type: 'number', id: rollupSourceNumberFieldId, name: 'Amount' },
        ],
      });

      const lookupContext: LookupFieldContext = {
        rollupSourceTableId: sourceTable.id,
      };

      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'Rollup Lookup',
        fields: lookupFieldSpecs.map((spec) => spec.buildInput(lookupContext)),
      });
      rollupForeignTableId = foreignTable.id;

      const hostTable = await createTable({
        baseId: ctx.baseId,
        name: 'Rollup Host',
        fields: [
          {
            type: 'singleLineText',
            id: rollupHostPrimaryFieldId,
            name: 'Name',
            isPrimary: true,
          },
        ],
      });
      rollupHostTableId = hostTable.id;

      const linkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: rollupHostTableId,
          field: {
            type: 'link',
            id: rollupHostLinkFieldId,
            name: 'Lookup Table',
            options: {
              relationship: 'manyMany',
              foreignTableId: rollupForeignTableId,
              lookupFieldId: rollupForeignPrimaryFieldId,
            },
          },
        }),
      });

      const linkRaw = await linkResponse.json();
      if (linkResponse.status !== 200) {
        throw new Error(`CreateField failed for rollup link: ${JSON.stringify(linkRaw)}`);
      }
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) {
        throw new Error(`Failed to create rollup link: ${JSON.stringify(linkRaw)}`);
      }
    });

    test.each(rollupCases)('creates rollup field for $caseLabel', async (entry) => {
      const rollupFieldId = createFieldId();
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: rollupHostTableId,
          field: {
            type: 'rollup',
            id: rollupFieldId,
            name: `Rollup ${entry.lookupLabel} ${entry.expression} ${rollupFieldId}`,
            options: { expression: entry.expression },
            config: {
              linkFieldId: rollupHostLinkFieldId,
              foreignTableId: rollupForeignTableId,
              lookupFieldId: entry.lookupFieldId,
            },
          },
        }),
      });

      const rawBody = await response.json();
      if (!entry.expectOk) {
        expect(response.status).not.toBe(200);
        const errorParsed = createFieldErrorResponseSchema.safeParse(rawBody);
        expect(errorParsed.success).toBe(true);
        if (!errorParsed.success) return;
        expect(errorParsed.data.ok).toBe(false);
        expect(errorParsed.data.error.message).toContain('Invalid RollupExpression');
        return;
      }

      if (response.status !== 200) {
        throw new Error(`CreateField failed for rollup: ${JSON.stringify(rawBody)}`);
      }
      expect(response.status).toBe(200);
      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((field) => field.id === rollupFieldId);
      expect(created).toBeTruthy();
      if (!created || created.type !== 'rollup') return;
      expect(created.options.expression).toBe(entry.expression);
      expect(created.config.lookupFieldId).toBe(entry.lookupFieldId);
    });
  });

  describe('lookup fields', () => {
    type FieldTypeLiteral = ITableFieldInput['type'];

    type LookupFieldSpec = {
      type: FieldTypeLiteral;
      label: string;
      id: string;
      name: string;
      expectedCellValueType: string;
      expectedIsMultiple: boolean;
      expectedOptions: Record<string, unknown>;
      buildInput: () => ITableFieldInput;
    };

    type LookupFieldFactory = () => ReadonlyArray<LookupFieldSpec>;

    const lookupForeignPrimaryFieldId = createFieldId();
    const lookupForeignLongTextFieldId = createFieldId();
    const lookupForeignNumberFieldId = createFieldId();
    const lookupForeignRatingFieldId = createFieldId();
    const lookupForeignSingleSelectFieldId = createFieldId();
    const lookupForeignMultipleSelectFieldId = createFieldId();
    const lookupForeignCheckboxFieldId = createFieldId();
    const lookupForeignAttachmentFieldId = createFieldId();
    const lookupForeignDateFieldId = createFieldId();
    const lookupForeignCreatedTimeFieldId = createFieldId();
    const lookupForeignAutoNumberFieldId = createFieldId();
    const lookupForeignUserFieldId = createFieldId();
    const lookupForeignCreatedByFieldId = createFieldId();

    const lookupHostPrimaryFieldId = createFieldId();
    const lookupHostLinkFieldId = createFieldId();

    // Map by field type to test lookup for different inner field types
    const lookupFieldFactories: Partial<Record<FieldTypeLiteral, LookupFieldFactory>> = {
      singleLineText: () => [
        {
          type: 'singleLineText',
          label: 'singleLineText',
          id: lookupForeignPrimaryFieldId,
          name: 'Lookup Name',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: { showAs: { type: 'email' }, defaultValue: 'test@example.com' },
          buildInput: () => ({
            type: 'singleLineText',
            id: lookupForeignPrimaryFieldId,
            name: 'Lookup Name',
            isPrimary: true,
            options: { showAs: { type: 'email' }, defaultValue: 'test@example.com' },
          }),
        },
      ],
      longText: () => [
        {
          type: 'longText',
          label: 'longText',
          id: lookupForeignLongTextFieldId,
          name: 'Lookup Notes',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: { defaultValue: 'Notes content' },
          buildInput: () => ({
            type: 'longText',
            id: lookupForeignLongTextFieldId,
            name: 'Lookup Notes',
            options: { defaultValue: 'Notes content' },
          }),
        },
      ],
      number: () => [
        {
          type: 'number',
          label: 'number',
          id: lookupForeignNumberFieldId,
          name: 'Lookup Amount',
          expectedCellValueType: 'number',
          expectedIsMultiple: true,
          expectedOptions: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            defaultValue: 100,
          },
          buildInput: () => ({
            type: 'number',
            id: lookupForeignNumberFieldId,
            name: 'Lookup Amount',
            options: {
              formatting: { type: 'currency', precision: 2, symbol: '$' },
              defaultValue: 100,
            },
          }),
        },
      ],
      rating: () => [
        {
          type: 'rating',
          label: 'rating',
          id: lookupForeignRatingFieldId,
          name: 'Lookup Rating',
          expectedCellValueType: 'number',
          expectedIsMultiple: true,
          expectedOptions: { max: 5, icon: 'heart', color: 'redBright' },
          buildInput: () => ({
            type: 'rating',
            id: lookupForeignRatingFieldId,
            name: 'Lookup Rating',
            options: { max: 5, icon: 'heart', color: 'redBright' },
          }),
        },
      ],
      singleSelect: () => [
        {
          type: 'singleSelect',
          label: 'singleSelect',
          id: lookupForeignSingleSelectFieldId,
          name: 'Lookup Status',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: {
            choices: [
              { id: 'lkp1', name: 'Active', color: 'green' },
              { id: 'lkp2', name: 'Inactive', color: 'gray' },
            ],
            defaultValue: 'Active',
          },
          buildInput: () => ({
            type: 'singleSelect',
            id: lookupForeignSingleSelectFieldId,
            name: 'Lookup Status',
            options: {
              choices: [
                { id: 'lkp1', name: 'Active', color: 'green' },
                { id: 'lkp2', name: 'Inactive', color: 'gray' },
              ],
              defaultValue: 'Active',
            },
          }),
        },
      ],
      multipleSelect: () => [
        {
          type: 'multipleSelect',
          label: 'multipleSelect',
          id: lookupForeignMultipleSelectFieldId,
          name: 'Lookup Tags',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: {
            choices: [
              { id: 'lkp3', name: 'TagA', color: 'purple' },
              { id: 'lkp4', name: 'TagB', color: 'teal' },
            ],
          },
          buildInput: () => ({
            type: 'multipleSelect',
            id: lookupForeignMultipleSelectFieldId,
            name: 'Lookup Tags',
            options: {
              choices: [
                { id: 'lkp3', name: 'TagA', color: 'purple' },
                { id: 'lkp4', name: 'TagB', color: 'teal' },
              ],
            },
          }),
        },
      ],
      checkbox: () => [
        {
          type: 'checkbox',
          label: 'checkbox',
          id: lookupForeignCheckboxFieldId,
          name: 'Lookup Done',
          expectedCellValueType: 'boolean',
          expectedIsMultiple: true,
          expectedOptions: { defaultValue: true },
          buildInput: () => ({
            type: 'checkbox',
            id: lookupForeignCheckboxFieldId,
            name: 'Lookup Done',
            options: { defaultValue: true },
          }),
        },
      ],
      attachment: () => [
        {
          type: 'attachment',
          label: 'attachment',
          id: lookupForeignAttachmentFieldId,
          name: 'Lookup Files',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: {},
          buildInput: () => ({
            type: 'attachment',
            id: lookupForeignAttachmentFieldId,
            name: 'Lookup Files',
          }),
        },
      ],
      date: () => [
        {
          type: 'date',
          label: 'date',
          id: lookupForeignDateFieldId,
          name: 'Lookup Date',
          expectedCellValueType: 'dateTime',
          expectedIsMultiple: true,
          expectedOptions: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
          buildInput: () => ({
            type: 'date',
            id: lookupForeignDateFieldId,
            name: 'Lookup Date',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          }),
        },
      ],
      createdTime: () => [
        {
          type: 'createdTime',
          label: 'createdTime',
          id: lookupForeignCreatedTimeFieldId,
          name: 'Lookup Created At',
          expectedCellValueType: 'dateTime',
          expectedIsMultiple: true,
          expectedOptions: {
            expression: 'CREATED_TIME()',
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
          buildInput: () => ({
            type: 'createdTime',
            id: lookupForeignCreatedTimeFieldId,
            name: 'Lookup Created At',
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            },
          }),
        },
      ],
      autoNumber: () => [
        {
          type: 'autoNumber',
          label: 'autoNumber',
          id: lookupForeignAutoNumberFieldId,
          name: 'Lookup Auto Number',
          expectedCellValueType: 'number',
          expectedIsMultiple: true,
          expectedOptions: { expression: 'AUTO_NUMBER()' },
          buildInput: () => ({
            type: 'autoNumber',
            id: lookupForeignAutoNumberFieldId,
            name: 'Lookup Auto Number',
          }),
        },
      ],
      user: () => [
        {
          type: 'user',
          label: 'user',
          id: lookupForeignUserFieldId,
          name: 'Lookup Owner',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: { isMultiple: true, shouldNotify: false },
          buildInput: () => ({
            type: 'user',
            id: lookupForeignUserFieldId,
            name: 'Lookup Owner',
            options: { isMultiple: true, shouldNotify: false },
          }),
        },
      ],
      createdBy: () => [
        {
          type: 'createdBy',
          label: 'createdBy',
          id: lookupForeignCreatedByFieldId,
          name: 'Lookup Created By',
          expectedCellValueType: 'string',
          expectedIsMultiple: true,
          expectedOptions: {},
          buildInput: () => ({
            type: 'createdBy',
            id: lookupForeignCreatedByFieldId,
            name: 'Lookup Created By',
          }),
        },
      ],
    };

    const lookupFieldSpecs = Object.values(lookupFieldFactories).flatMap((factory) =>
      factory ? factory() : []
    );

    type LookupCase = {
      caseLabel: string;
      lookupFieldId: string;
      innerType: FieldTypeLiteral;
      expectedCellValueType: string;
      expectedIsMultiple: boolean;
      expectedOptions: Record<string, unknown>;
    };

    const lookupCases: LookupCase[] = lookupFieldSpecs.map((spec) => ({
      caseLabel: spec.label,
      lookupFieldId: spec.id,
      innerType: spec.type,
      expectedCellValueType: spec.expectedCellValueType,
      expectedIsMultiple: spec.expectedIsMultiple,
      expectedOptions: spec.expectedOptions,
    }));

    let lookupHostTableId: string;
    let lookupForeignTableId: string;

    beforeAll(async () => {
      // Create foreign table with various field types
      const foreignTable = await createTable({
        baseId: ctx.baseId,
        name: 'Lookup Foreign',
        fields: lookupFieldSpecs.map((spec) => spec.buildInput()),
      });
      lookupForeignTableId = foreignTable.id;

      // Create host table
      const hostTable = await createTable({
        baseId: ctx.baseId,
        name: 'Lookup Host',
        fields: [
          {
            type: 'singleLineText',
            id: lookupHostPrimaryFieldId,
            name: 'Name',
            isPrimary: true,
          },
        ],
      });
      lookupHostTableId = hostTable.id;

      // Create link field from host to foreign
      const linkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: lookupHostTableId,
          field: {
            type: 'link',
            id: lookupHostLinkFieldId,
            name: 'Link to Foreign',
            options: {
              relationship: 'manyMany',
              foreignTableId: lookupForeignTableId,
              lookupFieldId: lookupForeignPrimaryFieldId,
            },
          },
        }),
      });

      const linkRaw = await linkResponse.json();
      if (linkResponse.status !== 200) {
        throw new Error(`CreateField failed for lookup link: ${JSON.stringify(linkRaw)}`);
      }
      const linkParsed = createFieldOkResponseSchema.safeParse(linkRaw);
      expect(linkParsed.success).toBe(true);
      if (!linkParsed.success || !linkParsed.data.ok) {
        throw new Error(`Failed to create lookup link: ${JSON.stringify(linkRaw)}`);
      }
    });

    test.each(lookupCases)('creates lookup field for $caseLabel inner type', async (entry) => {
      const lookupFieldId = createFieldId();
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: lookupHostTableId,
          field: {
            type: 'lookup',
            id: lookupFieldId,
            name: `Lookup ${entry.caseLabel} ${lookupFieldId}`,
            options: {
              linkFieldId: lookupHostLinkFieldId,
              foreignTableId: lookupForeignTableId,
              lookupFieldId: entry.lookupFieldId,
            },
          },
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 200) {
        throw new Error(`CreateField failed for lookup: ${JSON.stringify(rawBody)}`);
      }
      expect(response.status).toBe(200);

      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((field) => field.id === lookupFieldId);
      expect(created).toBeTruthy();
      if (!created) return;

      // Verify isLookup flag
      expect(created.isLookup).toBe(true);

      // Verify lookupOptions with exact values
      expect(created.lookupOptions).toEqual({
        linkFieldId: lookupHostLinkFieldId,
        foreignTableId: lookupForeignTableId,
        lookupFieldId: entry.lookupFieldId,
      });

      // Verify the inner type matches the expected type
      expect(created.type).toBe(entry.innerType);

      // Verify options match the inner field's expected options
      expect(created.options).toEqual(entry.expectedOptions);
    });

    it('creates nested lookup field (lookup -> lookup -> number)', async () => {
      // Table1: has a number field
      const nestedTable1NumberFieldId = createFieldId();
      const nestedTable1PrimaryFieldId = createFieldId();
      const nestedTable1 = await createTable({
        baseId: ctx.baseId,
        name: 'Nested Lookup Table1',
        fields: [
          { type: 'singleLineText', id: nestedTable1PrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'number',
            id: nestedTable1NumberFieldId,
            name: 'Amount',
            options: { formatting: { type: 'decimal', precision: 2 } },
          },
        ],
      });

      // Table2: links to Table1, has lookup to Table1's number field
      const nestedTable2PrimaryFieldId = createFieldId();
      const nestedTable2 = await createTable({
        baseId: ctx.baseId,
        name: 'Nested Lookup Table2',
        fields: [
          { type: 'singleLineText', id: nestedTable2PrimaryFieldId, name: 'Name', isPrimary: true },
        ],
      });

      const nestedTable2LinkFieldId = createFieldId();
      await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: nestedTable2.id,
          field: {
            type: 'link',
            id: nestedTable2LinkFieldId,
            name: 'Link to Table1',
            options: {
              relationship: 'manyMany',
              foreignTableId: nestedTable1.id,
              lookupFieldId: nestedTable1PrimaryFieldId,
            },
          },
        }),
      });

      const nestedTable2LookupFieldId = createFieldId();
      const table2LookupResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: nestedTable2.id,
          field: {
            type: 'lookup',
            id: nestedTable2LookupFieldId,
            name: 'Lookup Amount from Table1',
            options: {
              linkFieldId: nestedTable2LinkFieldId,
              foreignTableId: nestedTable1.id,
              lookupFieldId: nestedTable1NumberFieldId,
            },
          },
        }),
      });
      expect(table2LookupResponse.status).toBe(200);

      // Table3: links to Table2, has nested lookup to Table2's lookup field
      const nestedTable3PrimaryFieldId = createFieldId();
      const nestedTable3 = await createTable({
        baseId: ctx.baseId,
        name: 'Nested Lookup Table3',
        fields: [
          { type: 'singleLineText', id: nestedTable3PrimaryFieldId, name: 'Name', isPrimary: true },
        ],
      });

      const nestedTable3LinkFieldId = createFieldId();
      await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: nestedTable3.id,
          field: {
            type: 'link',
            id: nestedTable3LinkFieldId,
            name: 'Link to Table2',
            options: {
              relationship: 'manyMany',
              foreignTableId: nestedTable2.id,
              lookupFieldId: nestedTable2PrimaryFieldId,
            },
          },
        }),
      });

      // Create nested lookup: Table3 -> Table2 -> lookup field (which looks up Table1's number)
      const nestedLookupFieldId = createFieldId();
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: nestedTable3.id,
          field: {
            type: 'lookup',
            id: nestedLookupFieldId,
            name: 'Nested Lookup Amount',
            options: {
              linkFieldId: nestedTable3LinkFieldId,
              foreignTableId: nestedTable2.id,
              lookupFieldId: nestedTable2LookupFieldId,
            },
          },
        }),
      });

      expect(response.status).toBe(200);
      const rawBody = await response.json();
      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const created = parsed.data.data.table.fields.find((f) => f.id === nestedLookupFieldId);
      expect(created).toBeTruthy();
      if (!created) return;

      // Verify isLookup flag
      expect(created.isLookup).toBe(true);

      // Verify lookupOptions point to Table2's lookup field
      expect(created.lookupOptions).toEqual({
        linkFieldId: nestedTable3LinkFieldId,
        foreignTableId: nestedTable2.id,
        lookupFieldId: nestedTable2LookupFieldId,
      });

      // Nested lookup should inherit the inner-most field type (number)
      expect(created.type).toBe('number');

      // Options should match the original number field's options
      expect(created.options).toEqual({ formatting: { type: 'decimal', precision: 2 } });
    });

    it('rejects notNull/unique for lookup fields (computed)', async () => {
      const notNullResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: lookupHostTableId,
          field: {
            type: 'lookup',
            id: createFieldId(),
            name: 'Lookup NotNull',
            notNull: true,
            options: {
              linkFieldId: lookupHostLinkFieldId,
              foreignTableId: lookupForeignTableId,
              lookupFieldId: lookupForeignPrimaryFieldId,
            },
          },
        }),
      });
      // notNull on computed field should be rejected
      expect(notNullResponse.status).not.toBe(200);

      const uniqueResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: lookupHostTableId,
          field: {
            type: 'lookup',
            id: createFieldId(),
            name: 'Lookup Unique',
            unique: true,
            options: {
              linkFieldId: lookupHostLinkFieldId,
              foreignTableId: lookupForeignTableId,
              lookupFieldId: lookupForeignPrimaryFieldId,
            },
          },
        }),
      });
      // unique on computed field should be rejected
      expect(uniqueResponse.status).not.toBe(200);
    });

    it('rejects invalid linkFieldId', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: lookupHostTableId,
          field: {
            type: 'lookup',
            id: createFieldId(),
            name: 'Invalid Link',
            options: {
              linkFieldId: 'fldNonExistent12345',
              foreignTableId: lookupForeignTableId,
              lookupFieldId: lookupForeignPrimaryFieldId,
            },
          },
        }),
      });
      // Invalid linkFieldId should be rejected (400 or 404)
      expect(response.status).not.toBe(200);
    });

    it('rejects invalid lookupFieldId', async () => {
      const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableId: lookupHostTableId,
          field: {
            type: 'lookup',
            id: createFieldId(),
            name: 'Invalid Lookup Field',
            options: {
              linkFieldId: lookupHostLinkFieldId,
              foreignTableId: lookupForeignTableId,
              lookupFieldId: 'fldNonExistent12345',
            },
          },
        }),
      });
      // Invalid lookupFieldId should be rejected (400 or 404)
      expect(response.status).not.toBe(200);
    });
  });

  it('names symmetric link fields using the host table name', async () => {
    const hostCreateResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        name: 'Projects',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      }),
    });

    const hostRaw = await hostCreateResponse.json();
    const hostParsed = createTableOkResponseSchema.safeParse(hostRaw);
    expect(hostParsed.success).toBe(true);
    if (!hostParsed.success || !hostParsed.data.ok) {
      throw new Error(`Failed to create host table: ${JSON.stringify(hostRaw)}`);
    }
    const hostTableId = hostParsed.data.data.table.id;
    const hostPrimaryField = hostParsed.data.data.table.fields.find((field) => field.isPrimary);
    if (!hostPrimaryField) {
      throw new Error('Failed to resolve host primary field');
    }

    const foreignCreateResponse = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        name: 'Companies',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      }),
    });

    const foreignRaw = await foreignCreateResponse.json();
    const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
    expect(foreignParsed.success).toBe(true);
    if (!foreignParsed.success || !foreignParsed.data.ok) {
      throw new Error(`Failed to create foreign table: ${JSON.stringify(foreignRaw)}`);
    }
    const newForeignTableId = foreignParsed.data.data.table.id;
    const foreignPrimaryField = foreignParsed.data.data.table.fields.find(
      (field) => field.isPrimary
    );
    if (!foreignPrimaryField) {
      throw new Error('Failed to resolve foreign primary field');
    }

    const linkFieldId = createFieldId();
    const linkResponse = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId: hostTableId,
        field: {
          type: 'link',
          id: linkFieldId,
          name: 'Company',
          options: {
            relationship: 'manyOne',
            foreignTableId: newForeignTableId,
            lookupFieldId: foreignPrimaryField.id,
          },
        },
      }),
    });

    const linkRaw = await linkResponse.json();
    if (linkResponse.status !== 200) {
      throw new Error(`CreateField failed: ${JSON.stringify(linkRaw)}`);
    }
    expect(linkResponse.status).toBe(200);

    const getResponse = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${newForeignTableId}`,
      { method: 'GET' }
    );
    expect(getResponse.status).toBe(200);
    const getRaw = await getResponse.json();
    const getParsed = getTableByIdOkResponseSchema.safeParse(getRaw);
    expect(getParsed.success).toBe(true);
    if (!getParsed.success || !getParsed.data.ok) return;

    const symmetricField = getParsed.data.data.table.fields.find(
      (field) => field.type === 'link' && field.options.symmetricFieldId === linkFieldId
    );
    expect(symmetricField).toBeDefined();
    if (!symmetricField) return;
    expect(symmetricField.name).toBe('Projects');
  });

  it('rollup can aggregate lookup field values', async () => {
    const table1NumberFieldId = createFieldId();
    const table1PrimaryFieldId = createFieldId();
    const table1 = await createTable({
      baseId: ctx.baseId,
      name: 'Rollup Lookup Table1',
      fields: [
        { type: 'singleLineText', id: table1PrimaryFieldId, name: 'Name', isPrimary: true },
        { type: 'number', id: table1NumberFieldId, name: 'Value' },
      ],
    });

    const table2PrimaryFieldId = createFieldId();
    const table2 = await createTable({
      baseId: ctx.baseId,
      name: 'Rollup Lookup Table2',
      fields: [{ type: 'singleLineText', id: table2PrimaryFieldId, name: 'Name', isPrimary: true }],
    });

    const table2LinkFieldId = createFieldId();
    await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId: table2.id,
        field: {
          type: 'link',
          id: table2LinkFieldId,
          name: 'Link to Table1',
          options: {
            relationship: 'manyMany',
            foreignTableId: table1.id,
            lookupFieldId: table1PrimaryFieldId,
          },
        },
      }),
    });

    const table2LookupFieldId = createFieldId();
    await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId: table2.id,
        field: {
          type: 'lookup',
          id: table2LookupFieldId,
          name: 'Lookup Value',
          options: {
            linkFieldId: table2LinkFieldId,
            foreignTableId: table1.id,
            lookupFieldId: table1NumberFieldId,
          },
        },
      }),
    });

    // Create rollup field that aggregates the lookup field's source (table1.Value)
    // Rollup's lookupFieldId must point to a field in the foreignTable (table1)
    const rollupFieldId = createFieldId();
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId: table2.id,
        field: {
          type: 'rollup',
          id: rollupFieldId,
          name: 'Count Lookup Values',
          options: { expression: 'countall({values})' },
          config: {
            linkFieldId: table2LinkFieldId,
            foreignTableId: table1.id,
            lookupFieldId: table1NumberFieldId, // Points to foreign table field
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const rawBody = await response.json();
    const parsed = createFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) return;

    const created = parsed.data.data.table.fields.find((f) => f.id === rollupFieldId);
    expect(created).toBeTruthy();
    if (!created || created.type !== 'rollup') return;
    expect(created.config.lookupFieldId).toBe(table1NumberFieldId);
  });
});
