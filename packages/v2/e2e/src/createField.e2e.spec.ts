/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldErrorResponseSchema,
  createFieldOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ITableFieldInput } from '@teable/v2-core';
import {
  CellValueType,
  ROLLUP_FUNCTIONS,
  getRollupFunctionsByCellValueType,
} from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, test } from 'vitest';

describe('v2 http createField (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
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
      `${baseUrl}/tables/get?baseId=${baseId}&tableId=${targetTableId}`,
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
    const response = await fetch(`${baseUrl}/tables/create`, {
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
    const testContainer = await createV2NodeTestContainer();
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
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

    const foreignResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
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
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
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
        },
        expect: {
          type: 'singleLineText',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
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
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      if (created.type === 'formula') {
        expect(created.cellValueType).toBe(entry.expect.cellValueType);
        expect(created.isMultipleCellValue).toBe(entry.expect.isMultipleCellValue);
      }
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

      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
    const rollupForeignUserFieldId = createFieldId();
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
        baseId,
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
        baseId,
        name: 'Rollup Lookup',
        fields: lookupFieldSpecs.map((spec) => spec.buildInput(lookupContext)),
      });
      rollupForeignTableId = foreignTable.id;

      const hostTable = await createTable({
        baseId,
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

      const linkResponse = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
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
        expect(errorParsed.data.error).toContain('Invalid RollupExpression');
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

  it('names symmetric link fields using the host table name', async () => {
    const hostCreateResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
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

    const foreignCreateResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
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
    const linkResponse = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
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
      `${baseUrl}/tables/get?baseId=${baseId}&tableId=${newForeignTableId}`,
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
});
