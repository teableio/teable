/* eslint-disable sonarjs/no-duplicate-string */
import { registerV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  ConditionalLookupField,
  DateTimeFormatting,
  FieldId,
  FieldType,
  fieldTypeValues,
  LookupField,
  NumberFormatting,
  v2CoreTokens,
  CreateFieldsCommand,
  type ICommandBus,
  type Table,
  CreateRecordsCommand,
  type CreateRecordsResult,
  CreateTableCommand,
  type Field,
  type DomainError,
} from '@teable/v2-core';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { ok, type Result } from 'neverthrow';

import { FormulaSqlPgTranslator } from '../FormulaSqlPgTranslator';
import type { IPgTypeValidationStrategy } from '../PgTypeValidationStrategy';
import { makeExpr } from '../SqlExpression';
import { Pg16TypeValidationStrategy, PgLegacyTypeValidationStrategy } from '../strategies';

export type FieldTypeLiteral = (typeof fieldTypeValues)[number];
type DynamicDb = Record<string, Record<string, unknown>>;

export type FieldTypeCase = {
  type: FieldTypeLiteral;
  fieldName: string;
  isArray: boolean;
  numericValue?: number;
  numericArray?: ReadonlyArray<number>;
  expectsNumberError?: boolean;
};

export type FormulaFieldDefinition = {
  name: string;
  expression: string;
  expressionWithIds?: string;
};

type FieldSnapshotValue = {
  fieldName: string;
  fieldType: string;
  formatting?: unknown;
  rawValue: string | null;
  formattedValue: string | null;
  innerField?: FieldSnapshotValue | null;
};

type FormulaSnapshotContext = {
  formulaName: string;
  formula: string;
  sql: string;
  inputs: Record<string, FieldSnapshotValue>;
  result: string | null;
};

export type FormulaTestTable = {
  table: Table;
  translator: FormulaSqlPgTranslator;
  db: Kysely<DynamicDb>;
  formulaDefinitions: Map<string, FormulaFieldDefinition>;
  formulaFields: Map<string, Field>;
  fieldsByType: Partial<Record<FieldTypeLiteral, Field>>;
  tableAlias: string;
  fieldSnapshotCache: Map<string, Promise<FieldSnapshotValue>>;
};

type CreateFormulaTestTableOptions = {
  formulaTimeZone?: string;
  profile?: 'full' | 'minimal';
  fieldTypes?: ReadonlyArray<FieldTypeLiteral>;
};

const TABLE_ALIAS = 't';
const FORMULA_TYPE_FIELD_NAME = 'FormulaType';
const DEFAULT_DATE_FORMATTING = { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' };

const createFormulaContainer = (): Promise<IV2NodeTestContainer> =>
  createV2NodeTestContainer({
    connectionString: 'memory://',
    registerDb: async (container, config) => registerV2PostgresPgliteDb(container, config),
    computedUpdate: {
      hybridConfig: { syncPolicy: 'none' },
    },
  });

const isMemoryAccessOutOfBoundsError = (error: unknown): boolean => {
  const candidate =
    error instanceof Error
      ? [error.message, error.cause instanceof Error ? error.cause.message : ''].join(' ')
      : String(error);

  return candidate.toLowerCase().includes('memory access out of bounds');
};

export const createFormulaTestContainer = async (): Promise<IV2NodeTestContainer> => {
  try {
    return await createFormulaContainer();
  } catch (error) {
    if (!isMemoryAccessOutOfBoundsError(error)) {
      throw error;
    }
    return createFormulaContainer();
  }
};

const FIELD_TYPE_NAMES: Record<FieldTypeLiteral, string> = {
  singleLineText: 'SingleLineText',
  longText: 'LongText',
  number: 'Number',
  rating: 'Rating',
  formula: FORMULA_TYPE_FIELD_NAME,
  rollup: 'RollupType',
  conditionalRollup: 'ConditionalRollupType',
  lookup: 'LookupType',
  conditionalLookup: 'ConditionalLookupType',
  singleSelect: 'SingleSelect',
  multipleSelect: 'MultipleSelect',
  checkbox: 'Checkbox',
  attachment: 'Attachment',
  date: 'Date',
  createdTime: 'CreatedTime',
  lastModifiedTime: 'LastModifiedTime',
  user: 'User',
  createdBy: 'CreatedBy',
  lastModifiedBy: 'LastModifiedBy',
  autoNumber: 'AutoNumber',
  button: 'Button',
  link: 'LinkType',
};

const minimalFieldTypes = [
  'singleLineText',
  'number',
] as const satisfies ReadonlyArray<FieldTypeLiteral>;
const relationFieldTypes = new Set<FieldTypeLiteral>([
  'link',
  'lookup',
  'conditionalLookup',
  'rollup',
  'conditionalRollup',
]);

const resolveIncludedFieldTypes = (
  options?: CreateFormulaTestTableOptions
): ReadonlyArray<FieldTypeLiteral> => {
  if (options?.profile !== 'minimal') {
    return fieldTypeValues;
  }

  const included = new Set<FieldTypeLiteral>(options.fieldTypes ?? minimalFieldTypes);
  if (
    included.has('lookup') ||
    included.has('conditionalLookup') ||
    included.has('rollup') ||
    included.has('conditionalRollup')
  ) {
    included.add('link');
  }
  included.add('formula');
  return fieldTypeValues.filter((type) => included.has(type));
};

const fieldTypeSamples = (): Record<FieldTypeLiteral, FieldTypeCase> => ({
  singleLineText: {
    type: 'singleLineText',
    fieldName: FIELD_TYPE_NAMES.singleLineText,
    isArray: false,
    numericValue: 10,
  },
  longText: {
    type: 'longText',
    fieldName: FIELD_TYPE_NAMES.longText,
    isArray: false,
    numericValue: 10,
  },
  number: { type: 'number', fieldName: FIELD_TYPE_NAMES.number, isArray: false, numericValue: 10 },
  rating: { type: 'rating', fieldName: FIELD_TYPE_NAMES.rating, isArray: false, numericValue: 4 },
  formula: {
    type: 'formula',
    fieldName: FIELD_TYPE_NAMES.formula,
    isArray: false,
    numericValue: 10,
  },
  rollup: { type: 'rollup', fieldName: FIELD_TYPE_NAMES.rollup, isArray: false, numericValue: 10 },
  conditionalRollup: {
    type: 'conditionalRollup',
    fieldName: FIELD_TYPE_NAMES.conditionalRollup,
    isArray: false,
    numericValue: 10,
  },
  lookup: { type: 'lookup', fieldName: FIELD_TYPE_NAMES.lookup, isArray: true, numericArray: [10] },
  conditionalLookup: {
    type: 'conditionalLookup',
    fieldName: FIELD_TYPE_NAMES.conditionalLookup,
    isArray: true,
    numericArray: [10],
  },
  singleSelect: {
    type: 'singleSelect',
    fieldName: FIELD_TYPE_NAMES.singleSelect,
    isArray: false,
    numericValue: 10,
  },
  multipleSelect: {
    type: 'multipleSelect',
    fieldName: FIELD_TYPE_NAMES.multipleSelect,
    isArray: true,
    numericArray: [10, 20],
  },
  checkbox: {
    type: 'checkbox',
    fieldName: FIELD_TYPE_NAMES.checkbox,
    isArray: false,
    numericValue: 1,
  },
  attachment: {
    type: 'attachment',
    fieldName: FIELD_TYPE_NAMES.attachment,
    isArray: true,
    numericArray: [10, 20],
  },
  date: {
    type: 'date',
    fieldName: FIELD_TYPE_NAMES.date,
    isArray: false,
    expectsNumberError: true,
  },
  createdTime: {
    type: 'createdTime',
    fieldName: FIELD_TYPE_NAMES.createdTime,
    isArray: false,
    expectsNumberError: true,
  },
  lastModifiedTime: {
    type: 'lastModifiedTime',
    fieldName: FIELD_TYPE_NAMES.lastModifiedTime,
    isArray: false,
    expectsNumberError: true,
  },
  user: { type: 'user', fieldName: FIELD_TYPE_NAMES.user, isArray: true, numericArray: [10, 20] },
  createdBy: {
    type: 'createdBy',
    fieldName: FIELD_TYPE_NAMES.createdBy,
    isArray: false,
    expectsNumberError: true,
  },
  lastModifiedBy: {
    type: 'lastModifiedBy',
    fieldName: FIELD_TYPE_NAMES.lastModifiedBy,
    isArray: false,
    expectsNumberError: true,
  },
  autoNumber: {
    type: 'autoNumber',
    fieldName: FIELD_TYPE_NAMES.autoNumber,
    isArray: false,
    numericValue: 1,
  },
  button: { type: 'button', fieldName: FIELD_TYPE_NAMES.button, isArray: false },
  link: { type: 'link', fieldName: FIELD_TYPE_NAMES.link, isArray: false, numericValue: 10 },
});

const _fieldTypeExhaustive: Record<FieldTypeLiteral, FieldTypeCase> = fieldTypeSamples();
void _fieldTypeExhaustive;

export const createFieldTypeCases = (): ReadonlyArray<FieldTypeCase> =>
  Object.values(fieldTypeSamples());

const findFieldByName = (table: Table, name: string): Field => {
  const field = table.getFields().find((candidate) => candidate.name().toString() === name);
  if (!field) throw new Error(`Missing field: ${name}`);
  return field;
};

const resolveDbTableName = (table: Table): string =>
  table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

const buildUniqueName = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

const chunkItems = <T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const unwrapOrThrow = <T>(result: Result<T, DomainError>, label: string): T => {
  if (result.isErr()) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

const generateFieldId = (label: string): string =>
  unwrapOrThrow(FieldId.generate(), `FieldId.generate(${label})`).toString();

const executeCommand = async <TResult>(
  container: IV2NodeTestContainer,
  command: unknown
): Promise<TResult> => {
  const commandBus = container.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const context = { actorId: unwrapOrThrow(ActorId.create('system'), 'ActorId.create(system)') };
  const result = await commandBus.execute(context, command);
  return unwrapOrThrow(result as Result<TResult, DomainError>, 'CommandBus.execute');
};

const extractFieldRefs = (expression: string): ReadonlyArray<string> =>
  Array.from(expression.matchAll(/\{([^}]+)\}/g))
    .map((match) => match[1])
    .filter((ref): ref is string => Boolean(ref));

const replaceFormulaFieldRefs = (expression: string, fieldNameToId: Map<string, string>): string =>
  expression.replace(/\{([^}]+)\}/g, (match, ref) => {
    if (ref.startsWith('fld')) return match;
    const resolved = fieldNameToId.get(ref);
    return resolved ? `{${resolved}}` : match;
  });

const findFieldByRef = (table: Table, ref: string): Field => {
  const field = table
    .getFields()
    .find((candidate) => candidate.id().toString() === ref || candidate.name().toString() === ref);
  if (!field) throw new Error(`Missing field: ${ref}`);
  return field;
};

const normalizeTemporalText = (value: string | null): string | null => {
  if (!value) return value;
  if (!/[-/:+TZ]/.test(value)) return value.replace(/\d/g, '0');
  let normalized = value;
  const timeMatch = value.match(/(\d{2}:\d{2}:\d{2})(\.\d+)?/);
  if (timeMatch && !timeMatch[2]) {
    normalized = value.replace(timeMatch[1], `${timeMatch[1]}.000`);
  }
  return normalized.replace(/\d/g, '0');
};

const normalizeLinkRawValue = (value: string | null): string | null => {
  if (!value) return value;
  // Handle both escaped quotes (in JSON strings) and regular quotes
  return value
    .replace(/"id"\s*:\s*"rec[^"]+"/g, '"id": "rec_*"')
    .replace(/\\"id\\"\s*:\s*\\"rec[^"\\]+\\"/g, '\\"id\\": \\"rec_*\\"');
};

const VOLATILE_DATE_PART_FUNCTIONS = new Set([
  'MONTH',
  'WEEKNUM',
  'WEEKDAY',
  'DAY',
  'HOUR',
  'MINUTE',
  'SECOND',
]);

const extractTopLevelFunctionName = (formula: string): string | null => {
  const match = formula.trim().match(/^([A-Z_]+)\s*\(/i);
  return match ? match[1].toUpperCase() : null;
};

const normalizeVolatileResult = (
  value: string | null,
  hasTemporalInput: boolean,
  formula: string
): string | null => {
  if (!value || !hasTemporalInput) return value;

  // Handle array format: ["time1", "time2", ...]
  const arrayMatch = value.trim().match(/^\[(.*)\]$/);
  if (arrayMatch) {
    const arrayContent = arrayMatch[1];
    // Extract quoted strings from the array
    const quotedStrings = arrayContent.match(/"[^"]*"/g) || [];
    const normalizedStrings = quotedStrings.map((quoted) => {
      const unquoted = quoted.slice(1, -1); // Remove quotes
      const normalized = normalizeTemporalText(unquoted);
      return `"${normalized}"`;
    });
    return `[${normalizedStrings.join(', ')}]`;
  }

  if (/[-/:+TZ]/.test(value)) {
    return normalizeTemporalText(value);
  }
  const numericMatch = value.trim().match(/^-?\d+(?:\.\d+)?$/);
  if (numericMatch) {
    const functionName = extractTopLevelFunctionName(formula);
    if (functionName === 'YEAR') return '0000';
    if (functionName && VOLATILE_DATE_PART_FUNCTIONS.has(functionName)) return '0';
    return value.replace(/\d/g, '0');
  }
  return value.replace(/\d/g, '0');
};

const formatFieldFormatting = (field: Field): unknown => {
  const formatting = (field as { formatting?: () => unknown }).formatting?.();
  if (!formatting) return undefined;
  if (formatting instanceof NumberFormatting || formatting instanceof DateTimeFormatting) {
    return formatting.toDto();
  }
  return undefined;
};

const createForeignTable = async (
  container: IV2NodeTestContainer
): Promise<{ table: Table; primary: Field; number: Field; date: Field }> => {
  const baseId = container.baseId.toString();
  const command = unwrapOrThrow(
    CreateTableCommand.create({
      baseId,
      name: buildUniqueName('ForeignTable'),
      fields: [
        {
          type: 'singleLineText',
          id: generateFieldId('foreign-primary'),
          name: 'ForeignPrimary',
          isPrimary: true,
        },
        {
          type: 'number',
          id: generateFieldId('foreign-number'),
          name: 'ForeignNumber',
        },
        {
          type: 'date',
          id: generateFieldId('foreign-date'),
          name: 'ForeignDate',
        },
      ],
    }),
    'CreateTableCommand(ForeignTable)'
  );

  const result = await executeCommand<{ table: Table }>(container, command);
  const table = result.table;
  return {
    table,
    primary: findFieldByName(table, 'ForeignPrimary'),
    number: findFieldByName(table, 'ForeignNumber'),
    date: findFieldByName(table, 'ForeignDate'),
  };
};

const createHostTable = async (params: {
  container: IV2NodeTestContainer;
  foreignTable?: Table;
  foreignPrimary?: Field;
  foreignNumber?: Field;
  foreignDate?: Field;
  formulaFields: ReadonlyArray<FormulaFieldDefinition>;
  includedFieldTypes: ReadonlyArray<FieldTypeLiteral>;
}): Promise<{
  table: Table;
  fieldsByType: Partial<Record<FieldTypeLiteral, Field>>;
  formulaFields: Map<string, Field>;
  formulaFieldDefinitions: ReadonlyArray<FormulaFieldDefinition>;
}> => {
  const {
    container,
    foreignTable,
    foreignPrimary,
    foreignNumber,
    foreignDate,
    includedFieldTypes,
  } = params;
  const baseId = container.baseId.toString();
  const includedFieldTypeSet = new Set(includedFieldTypes);

  const formulaFieldDefinitions = [...params.formulaFields];
  if (!formulaFieldDefinitions.some((field) => field.name === FORMULA_TYPE_FIELD_NAME)) {
    formulaFieldDefinitions.push({ name: FORMULA_TYPE_FIELD_NAME, expression: '10' });
  }

  const linkFieldId = generateFieldId('link');
  const fieldIds: Record<FieldTypeLiteral, string> = {
    singleLineText: generateFieldId('singleLineText'),
    longText: generateFieldId('longText'),
    number: generateFieldId('number'),
    rating: generateFieldId('rating'),
    formula: generateFieldId('formula'),
    rollup: generateFieldId('rollup'),
    conditionalRollup: generateFieldId('conditionalRollup'),
    lookup: generateFieldId('lookup'),
    conditionalLookup: generateFieldId('conditionalLookup'),
    singleSelect: generateFieldId('singleSelect'),
    multipleSelect: generateFieldId('multipleSelect'),
    checkbox: generateFieldId('checkbox'),
    attachment: generateFieldId('attachment'),
    date: generateFieldId('date'),
    createdTime: generateFieldId('createdTime'),
    lastModifiedTime: generateFieldId('lastModifiedTime'),
    user: generateFieldId('user'),
    createdBy: generateFieldId('createdBy'),
    lastModifiedBy: generateFieldId('lastModifiedBy'),
    autoNumber: generateFieldId('autoNumber'),
    button: generateFieldId('button'),
    link: linkFieldId,
  };

  const formulaFieldIds = new Map<string, string>(
    formulaFieldDefinitions.map((definition) => [
      definition.name,
      definition.name === FORMULA_TYPE_FIELD_NAME
        ? fieldIds.formula
        : generateFieldId(`formula:${definition.name}`),
    ])
  );

  const fieldNameToId = new Map<string, string>();
  includedFieldTypes.forEach((type) => {
    if (type === 'formula') return;
    fieldNameToId.set(FIELD_TYPE_NAMES[type], fieldIds[type]);
  });
  formulaFieldIds.forEach((id, name) => fieldNameToId.set(name, id));

  const lookupNumberId = includedFieldTypeSet.has('lookup')
    ? generateFieldId('lookup-number')
    : undefined;
  const lookupDateId = includedFieldTypeSet.has('lookup')
    ? generateFieldId('lookup-date')
    : undefined;
  if (lookupNumberId) {
    fieldNameToId.set('LookupNumber', lookupNumberId);
  }
  if (lookupDateId) {
    fieldNameToId.set('LookupDate', lookupDateId);
  }

  const resolvedFormulaFieldDefinitions = formulaFieldDefinitions.map((definition) => ({
    ...definition,
    expressionWithIds: replaceFormulaFieldRefs(definition.expression, fieldNameToId),
  }));

  const orderedFormulaFieldDefinitions = [
    ...resolvedFormulaFieldDefinitions.filter(
      (definition) => definition.name === FORMULA_TYPE_FIELD_NAME
    ),
    ...resolvedFormulaFieldDefinitions.filter(
      (definition) => definition.name !== FORMULA_TYPE_FIELD_NAME
    ),
  ];

  const fields = includedFieldTypes
    .filter(
      (type) =>
        type !== 'formula' &&
        type !== 'lookup' &&
        type !== 'conditionalLookup' &&
        type !== 'rollup' &&
        type !== 'conditionalRollup'
    )
    .map((type) => {
      switch (type) {
        case 'singleLineText':
          return {
            type,
            id: fieldIds.singleLineText,
            name: FIELD_TYPE_NAMES.singleLineText,
            isPrimary: true,
          };
        case 'longText':
          return { type, id: fieldIds.longText, name: FIELD_TYPE_NAMES.longText };
        case 'number':
          return {
            type,
            id: fieldIds.number,
            name: FIELD_TYPE_NAMES.number,
            options: { formatting: { type: 'decimal', precision: 2 } },
          };
        case 'rating':
          return { type, id: fieldIds.rating, name: FIELD_TYPE_NAMES.rating };
        case 'singleSelect':
          return {
            type,
            id: fieldIds.singleSelect,
            name: FIELD_TYPE_NAMES.singleSelect,
            options: ['10', '20'],
          };
        case 'multipleSelect':
          return {
            type,
            id: fieldIds.multipleSelect,
            name: FIELD_TYPE_NAMES.multipleSelect,
            options: ['10', '20'],
          };
        case 'checkbox':
          return { type, id: fieldIds.checkbox, name: FIELD_TYPE_NAMES.checkbox };
        case 'attachment':
          return { type, id: fieldIds.attachment, name: FIELD_TYPE_NAMES.attachment };
        case 'date':
          return {
            type,
            id: fieldIds.date,
            name: FIELD_TYPE_NAMES.date,
            options: { formatting: DEFAULT_DATE_FORMATTING },
          };
        case 'createdTime':
          return {
            type,
            id: fieldIds.createdTime,
            name: FIELD_TYPE_NAMES.createdTime,
            options: { formatting: DEFAULT_DATE_FORMATTING },
          };
        case 'lastModifiedTime':
          return {
            type,
            id: fieldIds.lastModifiedTime,
            name: FIELD_TYPE_NAMES.lastModifiedTime,
            options: { formatting: DEFAULT_DATE_FORMATTING },
          };
        case 'user':
          return {
            type,
            id: fieldIds.user,
            name: FIELD_TYPE_NAMES.user,
            options: { isMultiple: true },
          };
        case 'createdBy':
          return { type, id: fieldIds.createdBy, name: FIELD_TYPE_NAMES.createdBy };
        case 'lastModifiedBy':
          return { type, id: fieldIds.lastModifiedBy, name: FIELD_TYPE_NAMES.lastModifiedBy };
        case 'autoNumber':
          return { type, id: fieldIds.autoNumber, name: FIELD_TYPE_NAMES.autoNumber };
        case 'button':
          return { type, id: fieldIds.button, name: FIELD_TYPE_NAMES.button };
        case 'link':
          if (!foreignTable || !foreignPrimary) {
            throw new Error('Link field requires a foreign table');
          }
          return {
            type,
            id: linkFieldId,
            name: FIELD_TYPE_NAMES.link,
            options: {
              relationship: 'manyOne',
              foreignTableId: foreignTable.id().toString(),
              lookupFieldId: foreignPrimary.id().toString(),
              isOneWay: true,
            },
          };
      }
    });

  const command = unwrapOrThrow(
    CreateTableCommand.create({
      baseId,
      name: buildUniqueName('HostTable'),
      fields,
    }),
    'CreateTableCommand(HostTable)'
  );

  const result = await executeCommand<{ table: Table }>(container, command);
  let table = result.table;

  const relationFields: Array<Record<string, unknown>> = [];
  if (includedFieldTypeSet.has('lookup')) {
    if (
      !foreignTable ||
      !foreignPrimary ||
      !foreignNumber ||
      !foreignDate ||
      !lookupNumberId ||
      !lookupDateId
    ) {
      throw new Error('Lookup fields require a foreign table');
    }
    relationFields.push(
      {
        type: 'lookup',
        id: fieldIds.lookup,
        name: FIELD_TYPE_NAMES.lookup,
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignPrimary.id().toString(),
        },
      },
      {
        type: 'lookup',
        id: lookupNumberId,
        name: 'LookupNumber',
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignNumber.id().toString(),
        },
      },
      {
        type: 'lookup',
        id: lookupDateId,
        name: 'LookupDate',
        options: {
          linkFieldId,
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignDate.id().toString(),
        },
      }
    );
  }

  if (includedFieldTypeSet.has('rollup')) {
    if (!foreignTable || !foreignNumber) {
      throw new Error('Rollup field requires a foreign table');
    }
    relationFields.push({
      type: 'rollup',
      id: fieldIds.rollup,
      name: FIELD_TYPE_NAMES.rollup,
      options: { expression: 'sum({values})', formatting: { type: 'decimal', precision: 2 } },
      config: {
        linkFieldId,
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignNumber.id().toString(),
      },
    });
  }

  const nonEmptyCondition =
    foreignNumber == null
      ? undefined
      : {
          filter: {
            conjunction: 'and' as const,
            filterSet: [
              {
                fieldId: foreignNumber.id().toString(),
                operator: 'isNotEmpty' as const,
                value: null,
              },
            ] as const,
          },
        };

  if (includedFieldTypeSet.has('conditionalLookup')) {
    if (!foreignTable || !foreignNumber || !nonEmptyCondition) {
      throw new Error('Conditional lookup field requires a foreign table');
    }
    relationFields.push({
      type: 'conditionalLookup',
      id: fieldIds.conditionalLookup,
      name: FIELD_TYPE_NAMES.conditionalLookup,
      options: {
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignNumber.id().toString(),
        condition: nonEmptyCondition,
      },
    });
  }

  if (includedFieldTypeSet.has('conditionalRollup')) {
    if (!foreignTable || !foreignNumber || !nonEmptyCondition) {
      throw new Error('Conditional rollup field requires a foreign table');
    }
    relationFields.push({
      type: 'conditionalRollup',
      id: fieldIds.conditionalRollup,
      name: FIELD_TYPE_NAMES.conditionalRollup,
      options: { expression: 'sum({values})', formatting: { type: 'decimal', precision: 2 } },
      config: {
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignNumber.id().toString(),
        condition: nonEmptyCondition,
      },
    });
  }

  if (relationFields.length > 0) {
    const relationCommand = unwrapOrThrow(
      CreateFieldsCommand.create({
        baseId,
        tableId: table.id().toString(),
        fields: relationFields,
      }),
      'CreateFieldsCommand(RelationFields)'
    );
    table = (await executeCommand<{ table: Table }>(container, relationCommand)).table;
  }

  // Create formula fields (including the matrix input formula field) before inserting records.
  // This avoids triggering computed updates/backfills on large existing datasets.
  const formulaFieldBatches = chunkItems(
    orderedFormulaFieldDefinitions.map((definition) => ({
      type: 'formula' as const,
      id: formulaFieldIds.get(definition.name),
      name: definition.name,
      options: { expression: definition.expressionWithIds ?? definition.expression },
    })),
    24
  );
  for (const [batchIndex, formulaFields] of formulaFieldBatches.entries()) {
    const formulaCommand = unwrapOrThrow(
      CreateFieldsCommand.create({
        baseId,
        tableId: table.id().toString(),
        fields: formulaFields,
      }),
      `CreateFieldsCommand(FormulaFields:${String(batchIndex + 1)})`
    );
    table = (await executeCommand<{ table: Table }>(container, formulaCommand)).table;
  }

  const fieldsByType = includedFieldTypes.reduce<Partial<Record<FieldTypeLiteral, Field>>>(
    (acc, type) => {
      acc[type] =
        type === 'formula'
          ? findFieldByName(table, FORMULA_TYPE_FIELD_NAME)
          : findFieldByName(table, FIELD_TYPE_NAMES[type]);
      return acc;
    },
    {}
  );

  const formulaFieldMap = new Map<string, Field>();
  resolvedFormulaFieldDefinitions.forEach((definition) => {
    formulaFieldMap.set(definition.name, findFieldByName(table, definition.name));
  });

  return {
    table,
    fieldsByType,
    formulaFields: formulaFieldMap,
    formulaFieldDefinitions: resolvedFormulaFieldDefinitions,
  };
};

const createForeignRecord = async (
  container: IV2NodeTestContainer,
  table: Table
): Promise<string> => {
  const primary = findFieldByName(table, 'ForeignPrimary');
  const number = findFieldByName(table, 'ForeignNumber');
  const date = findFieldByName(table, 'ForeignDate');
  const command = unwrapOrThrow(
    CreateRecordsCommand.create({
      tableId: table.id().toString(),
      records: [
        {
          fields: {
            [primary.id().toString()]: '10',
            [number.id().toString()]: 10,
            [date.id().toString()]: '2024-01-03T00:00:00Z',
          },
        },
      ],
    }),
    'CreateRecordsCommand(ForeignRecord)'
  );
  const result = await executeCommand<CreateRecordsResult>(container, command);
  const recordId = result.records[0]?.id().toString();
  if (!recordId) throw new Error('Missing foreign record id');
  return recordId;
};

const seedAttachments = async (db: Kysely<unknown>): Promise<void> => {
  const attachments = [
    {
      id: 'att_1',
      token: 'tok_1',
      path: '/tmp/10',
      size: 10,
      mimetype: 'text/plain',
      created_by: 'system',
    },
    {
      id: 'att_2',
      token: 'tok_2',
      path: '/tmp/20',
      size: 20,
      mimetype: 'text/plain',
      created_by: 'system',
    },
  ];
  for (const att of attachments) {
    await sql`
      INSERT INTO attachments (id, token, path, size, mimetype, created_by)
      VALUES (${att.id}, ${att.token}, ${att.path}, ${att.size}, ${att.mimetype}, ${att.created_by})
      ON CONFLICT (id) DO NOTHING
    `.execute(db);
  }
};

const createHostRecord = async (
  container: IV2NodeTestContainer,
  table: Table,
  fieldsByType: Partial<Record<FieldTypeLiteral, Field>>,
  foreignRecordId?: string
) => {
  const attachmentsAvailable = await hasTable(container.db as Kysely<unknown>, 'attachments');
  const fields: Record<string, unknown> = {};
  if (fieldsByType.singleLineText) {
    fields[fieldsByType.singleLineText.id().toString()] = '10';
  }
  if (fieldsByType.longText) {
    fields[fieldsByType.longText.id().toString()] = '10';
  }
  if (fieldsByType.number) {
    fields[fieldsByType.number.id().toString()] = 10;
  }
  if (fieldsByType.rating) {
    fields[fieldsByType.rating.id().toString()] = 4;
  }
  if (fieldsByType.singleSelect) {
    fields[fieldsByType.singleSelect.id().toString()] = '10';
  }
  if (fieldsByType.multipleSelect) {
    fields[fieldsByType.multipleSelect.id().toString()] = ['10', '20'];
  }
  if (fieldsByType.checkbox) {
    fields[fieldsByType.checkbox.id().toString()] = true;
  }
  if (fieldsByType.date) {
    fields[fieldsByType.date.id().toString()] = '2024-02-03T00:00:00Z';
  }
  if (fieldsByType.link && foreignRecordId) {
    fields[fieldsByType.link.id().toString()] = { id: foreignRecordId, title: '10' };
  }

  if (attachmentsAvailable && fieldsByType.attachment) {
    // Seed attachments table first
    await seedAttachments(container.db as Kysely<unknown>);

    fields[fieldsByType.attachment.id().toString()] = [
      {
        id: 'att_1',
        name: '10',
        path: '/tmp/10',
        token: 'tok_1',
        size: 10,
        mimetype: 'text/plain',
      },
      {
        id: 'att_2',
        name: '20',
        path: '/tmp/20',
        token: 'tok_2',
        size: 20,
        mimetype: 'text/plain',
      },
    ];
  }
  const command = unwrapOrThrow(
    CreateRecordsCommand.create({
      tableId: table.id().toString(),
      records: [
        {
          fields,
        },
      ],
    }),
    'CreateRecordsCommand(HostRecord)'
  );
  await executeCommand(container, command);
};

const clearStoredComputedFieldValues = async (db: Kysely<unknown>, table: Table): Promise<void> => {
  const columns = table
    .getFields()
    .filter(
      (field) =>
        field.type().equals(FieldType.formula()) ||
        field.type().equals(FieldType.lookup()) ||
        field.type().equals(FieldType.conditionalLookup()) ||
        field.type().equals(FieldType.rollup()) ||
        field.type().equals(FieldType.conditionalRollup())
    )
    .map((field) =>
      field
        .dbFieldName()
        .andThen((dbField) => dbField.value())
        .map((column) => column)
        .unwrapOr(undefined)
    )
    .filter((column): column is string => Boolean(column));
  if (columns.length === 0) return;

  const tableName = resolveDbTableName(table);
  await sql`
    UPDATE ${sql.table(tableName)}
    SET ${sql.join(columns.map((column) => sql`${sql.ref(column)} = NULL`))}
  `.execute(db);
};

export const createFormulaTestTable = async (
  container: IV2NodeTestContainer,
  formulaFields: ReadonlyArray<FormulaFieldDefinition>,
  options?: CreateFormulaTestTableOptions
): Promise<FormulaTestTable> => {
  const includedFieldTypes = resolveIncludedFieldTypes(options);
  const needsForeignTable = includedFieldTypes.some((type) => relationFieldTypes.has(type));
  const formulaFieldDefinitions = [...formulaFields];
  if (!formulaFieldDefinitions.some((field) => field.name === FORMULA_TYPE_FIELD_NAME)) {
    formulaFieldDefinitions.push({ name: FORMULA_TYPE_FIELD_NAME, expression: '10' });
  }
  const foreign = needsForeignTable ? await createForeignTable(container) : undefined;
  const host = await createHostTable({
    container,
    foreignTable: foreign?.table,
    foreignPrimary: foreign?.primary,
    foreignNumber: foreign?.number,
    foreignDate: foreign?.date,
    formulaFields: formulaFieldDefinitions,
    includedFieldTypes,
  });
  const formulaDefinitions = new Map(
    host.formulaFieldDefinitions.map((definition) => [definition.name, definition])
  );
  const foreignRecordId = foreign ? await createForeignRecord(container, foreign.table) : undefined;
  await createHostRecord(container, host.table, host.fieldsByType, foreignRecordId);
  await clearStoredComputedFieldValues(container.db as unknown as Kysely<unknown>, host.table);

  const typeValidationStrategy = await detectTypeValidationStrategy(
    container.db as unknown as Kysely<unknown>
  );
  const translator = new FormulaSqlPgTranslator({
    table: host.table,
    tableAlias: TABLE_ALIAS,
    typeValidationStrategy,
    timeZone: options?.formulaTimeZone ?? 'utc',
    resolveFieldSql: (field) =>
      field
        .dbFieldName()
        .andThen((dbField) => dbField.value())
        .map((column) =>
          makeExpr(`"${TABLE_ALIAS}"."${column}"`, 'unknown', false, undefined, undefined, field)
        )
        .orElse(() => ok(makeExpr('NULL', 'unknown', false, undefined, undefined, field))),
  });

  return {
    table: host.table,
    translator,
    db: container.db as unknown as Kysely<DynamicDb>,
    formulaDefinitions,
    formulaFields: host.formulaFields,
    fieldsByType: host.fieldsByType,
    tableAlias: TABLE_ALIAS,
    fieldSnapshotCache: new Map<string, Promise<FieldSnapshotValue>>(),
  };
};

export const executeFormulaAsText = async (
  testTable: FormulaTestTable,
  formulaName: string
): Promise<string | null> => {
  const formulaDefinition = testTable.formulaDefinitions.get(formulaName);
  if (!formulaDefinition) throw new Error(`Missing formula definition: ${formulaName}`);
  const expression = formulaDefinition.expressionWithIds ?? formulaDefinition.expression;
  const sqlExprResult = testTable.translator.translateExpression(expression);
  const sqlExpr = sqlExprResult._unsafeUnwrap();
  const rendered = testTable.translator.renderSql(sqlExpr);
  const tableName = resolveDbTableName(testTable.table);

  const result = await sql<{ value: string | null }>`
    SELECT (${sql.raw(rendered)})::text as value
    FROM ${sql.table(tableName)} AS ${sql.ref(testTable.tableAlias)}
    LIMIT 1
  `.execute(testTable.db);

  return result.rows[0]?.value ?? null;
};

const fetchSqlValue = async (
  testTable: FormulaTestTable,
  sqlExpression: string
): Promise<string | null> => {
  const tableName = resolveDbTableName(testTable.table);
  const result = await sql<{ value: string | null }>`
    SELECT (${sql.raw(sqlExpression)})::text as value
    FROM ${sql.table(tableName)} AS ${sql.ref(testTable.tableAlias)}
    LIMIT 1
  `.execute(testTable.db);
  return result.rows[0]?.value ?? null;
};

const buildFormattedFieldValueSql = (testTable: FormulaTestTable, field: Field): string => {
  const fieldId = field.id().toString();
  const expr = `CONCATENATE({${fieldId}}, "")`;
  const sqlExprResult = testTable.translator.translateExpression(expr);
  const sqlExpr = sqlExprResult._unsafeUnwrap();
  return testTable.translator.renderSql(sqlExpr);
};

const fetchRawFieldValueSql = (field: Field, tableAlias: string): string => {
  return field
    .dbFieldName()
    .andThen((dbField) => dbField.value())
    .map((name) => `"${tableAlias}"."${name}"`)
    .orElse(() => ok('NULL'))
    ._unsafeUnwrap();
};

const resolveLookupInnerField = (field: Field): Field | null => {
  if (field.type().equals(FieldType.lookup())) {
    const innerResult = (field as LookupField).innerField();
    return innerResult.isOk() ? innerResult.value : null;
  }
  if (field.type().equals(FieldType.conditionalLookup())) {
    const innerResult = (field as ConditionalLookupField).innerField();
    return innerResult.isOk() ? innerResult.value : null;
  }
  return null;
};

const buildFieldSnapshotValue = async (
  testTable: FormulaTestTable,
  field: Field,
  options: { includeValues?: boolean; visited?: ReadonlySet<string> } = {}
): Promise<FieldSnapshotValue> => {
  const includeValues = options.includeValues ?? true;
  const visited = options.visited ?? new Set<string>();
  const fieldId = field.id().toString();
  const nextVisited = new Set(visited);
  nextVisited.add(fieldId);

  const fieldType = field.type().toString();
  const isTemporalField = fieldType === 'createdTime' || fieldType === 'lastModifiedTime';
  const formatting = formatFieldFormatting(field);

  let normalizedRawValue: string | null = null;
  let normalizedFormattedValue: string | null = null;
  if (includeValues) {
    const rawSql = fetchRawFieldValueSql(field, testTable.tableAlias);
    const formattedSql = buildFormattedFieldValueSql(testTable, field);
    const [rawValue, formattedValue] = await Promise.all([
      fetchSqlValue(testTable, rawSql),
      fetchSqlValue(testTable, formattedSql),
    ]);
    normalizedRawValue = isTemporalField
      ? normalizeTemporalText(rawValue)
      : fieldType === 'formula'
        ? null
        : fieldType === 'link'
          ? normalizeLinkRawValue(rawValue)
          : rawValue;
    normalizedFormattedValue = isTemporalField
      ? normalizeTemporalText(formattedValue)
      : formattedValue;
  }

  let innerField: FieldSnapshotValue | null = null;
  const resolvedInnerField = resolveLookupInnerField(field);
  if (resolvedInnerField) {
    const innerFieldId = resolvedInnerField.id().toString();
    if (!nextVisited.has(innerFieldId)) {
      innerField = await buildFieldSnapshotValue(testTable, resolvedInnerField, {
        includeValues: false,
        visited: nextVisited,
      });
    }
  }

  const snapshot: FieldSnapshotValue = {
    fieldName: field.name().toString(),
    fieldType,
    formatting,
    rawValue: normalizedRawValue,
    formattedValue: normalizedFormattedValue,
  };

  if (
    field.type().equals(FieldType.lookup()) ||
    field.type().equals(FieldType.conditionalLookup())
  ) {
    return { ...snapshot, innerField };
  }

  return snapshot;
};

const getFieldSnapshotValue = (
  testTable: FormulaTestTable,
  field: Field
): Promise<FieldSnapshotValue> => {
  const fieldId = field.id().toString();
  const cached = testTable.fieldSnapshotCache.get(fieldId);
  if (cached) return cached;
  const pending = buildFieldSnapshotValue(testTable, field);
  testTable.fieldSnapshotCache.set(fieldId, pending);
  return pending;
};

export const buildFormulaSnapshotContext = async (
  testTable: FormulaTestTable,
  formulaName: string
): Promise<FormulaSnapshotContext> => {
  const formulaDefinition = testTable.formulaDefinitions.get(formulaName);
  if (!formulaDefinition) throw new Error(`Missing formula definition: ${formulaName}`);

  const expression = formulaDefinition.expressionWithIds ?? formulaDefinition.expression;
  const sqlExprResult = testTable.translator.translateExpression(expression);
  const sqlExpr = sqlExprResult._unsafeUnwrap();
  const renderedSql = testTable.translator.renderSql(sqlExpr);
  const result = await fetchSqlValue(testTable, renderedSql);

  const refs = extractFieldRefs(formulaDefinition.expression);
  const inputValues = await Promise.all(
    refs.map(async (ref) => {
      const field = findFieldByRef(testTable.table, ref);
      const snapshot = await getFieldSnapshotValue(testTable, field);
      return [ref, snapshot] as const;
    })
  );
  const hasTemporalInput = inputValues.some(
    ([, snapshot]) =>
      snapshot.fieldType === 'createdTime' || snapshot.fieldType === 'lastModifiedTime'
  );
  const hasLinkInput = inputValues.some(([, snapshot]) => snapshot.fieldType === 'link');
  let normalizedResult = normalizeVolatileResult(
    result,
    hasTemporalInput,
    formulaDefinition.expression
  );
  // Normalize link record IDs in result to make snapshots stable
  if (hasLinkInput && normalizedResult) {
    normalizedResult = normalizeLinkRawValue(normalizedResult);
  }

  return {
    formulaName,
    formula: formulaDefinition.expression,
    sql: normalizeTypeValidationSql(renderedSql),
    inputs: Object.fromEntries(inputValues),
    result: normalizedResult,
  };
};

const normalizeTypeValidationSql = (sqlText: string): string =>
  sqlText
    .replace(/\bpg_input_is_valid\s*\(/g, '__teable_input_is_valid(')
    .replace(/\bpublic\.teable_try_cast_valid\s*\(/g, '__teable_input_is_valid(');

const detectTypeValidationStrategy = async (
  db: Kysely<unknown>
): Promise<IPgTypeValidationStrategy> => {
  try {
    await sql`SELECT pg_input_is_valid('1', 'numeric')`.execute(db);
    return new Pg16TypeValidationStrategy();
  } catch (error) {
    if (isUndefinedFunctionError(error)) {
      return new PgLegacyTypeValidationStrategy();
    }
    throw error;
  }
};

const hasTable = async (db: Kysely<unknown>, tableName: string): Promise<boolean> => {
  const result = await sql<{ name: string | null }>`
    SELECT to_regclass(${`public.${tableName}`}) as name
  `.execute(db);
  return Boolean(result.rows[0]?.name);
};

const isUndefinedFunctionError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const pgError = error as { code?: string; message?: string };
  if (pgError.code === '42883') return true;
  const message = (pgError.message ?? '').toLowerCase();
  if (!message.includes('pg_input_is_valid')) return false;
  if (message.includes('does not exist')) return true;
  if (message.includes('no such function')) return true;
  if (message.includes('undefined function')) return true;
  return false;
};
