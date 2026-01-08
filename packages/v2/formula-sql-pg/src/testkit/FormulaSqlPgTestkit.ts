import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  DateTimeFormatting,
  FieldId,
  fieldTypeValues,
  NumberFormatting,
  v2CoreTokens,
  type ICommandBus,
  type Table,
  CreateFieldCommand,
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
import { makeExpr } from '../SqlExpression';

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
};

export type FormulaTestTable = {
  table: Table;
  translator: FormulaSqlPgTranslator;
  db: Kysely<DynamicDb>;
  formulaFields: Map<string, Field>;
  formulaDefinitions: Map<string, FormulaFieldDefinition>;
  fieldsByType: Record<FieldTypeLiteral, Field>;
  tableAlias: string;
  fieldSnapshotCache: Map<string, Promise<FieldSnapshotValue>>;
};

const TABLE_ALIAS = 't';
const FORMULA_TYPE_FIELD_NAME = 'FormulaType';
const DEFAULT_DATE_FORMATTING = { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' };

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

const replaceFieldNameRefs = (
  expression: string,
  nameToId: ReadonlyMap<string, string>
): string => {
  let nextExpression = expression;
  nameToId.forEach((fieldId, fieldName) => {
    nextExpression = nextExpression.split(`{${fieldName}}`).join(`{${fieldId}}`);
  });
  return nextExpression;
};

const buildNameToIdMap = (table: Table): Map<string, string> => {
  const map = new Map<string, string>();
  table.getFields().forEach((field) => {
    const fieldId = field.id().toString();
    const fieldName = field.name().toString();
    map.set(fieldName, fieldId);

    const fieldType = field.type().toString();
    if (fieldType !== 'formula') {
      const typeName = FIELD_TYPE_NAMES[fieldType];
      if (!map.has(typeName)) {
        map.set(typeName, fieldId);
      }
      return;
    }

    if (fieldName === FORMULA_TYPE_FIELD_NAME) {
      map.set(FORMULA_TYPE_FIELD_NAME, fieldId);
    }
  });
  return map;
};

const extractFieldRefs = (expression: string): ReadonlyArray<string> =>
  Array.from(expression.matchAll(/\{([^}]+)\}/g))
    .map((match) => match[1])
    .filter((ref): ref is string => Boolean(ref));

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

const resolveFormulaFields = async (params: {
  container: IV2NodeTestContainer;
  table: Table;
  formulaFields: ReadonlyArray<FormulaFieldDefinition>;
}): Promise<Table> => {
  const { container } = params;
  let table = params.table;
  const pending = [...params.formulaFields];

  while (pending.length > 0) {
    const nameToId = buildNameToIdMap(table);
    const knownIds = new Set(Array.from(nameToId.values()));
    const readyIndex = pending.findIndex((definition) => {
      const refs = extractFieldRefs(definition.expression);
      return refs.every((ref) => nameToId.has(ref) || knownIds.has(ref));
    });

    if (readyIndex === -1) {
      const remaining = pending
        .map((definition) => {
          const refs = extractFieldRefs(definition.expression).filter(
            (ref) => !nameToId.has(ref) && !knownIds.has(ref)
          );
          return `${definition.name} -> ${refs.join(', ') || 'unknown'}`;
        })
        .join('; ');
      throw new Error(`Formula field references not resolved: ${remaining}`);
    }

    const [definition] = pending.splice(readyIndex, 1);
    const expression = replaceFieldNameRefs(definition.expression, nameToId);
    const command = unwrapOrThrow(
      CreateFieldCommand.create({
        baseId: container.baseId.toString(),
        tableId: table.id().toString(),
        field: {
          type: 'formula',
          name: definition.name,
          options: { expression },
        },
      }),
      `CreateFieldCommand(${definition.name})`
    );
    const result = await executeCommand<{ table: Table }>(container, command);
    table = result.table;
  }

  return table;
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
  foreignTable: Table;
  foreignPrimary: Field;
  foreignNumber: Field;
  foreignDate: Field;
  formulaFields: ReadonlyArray<FormulaFieldDefinition>;
}): Promise<{
  table: Table;
  fieldsByType: Record<FieldTypeLiteral, Field>;
  formulaFields: Map<string, Field>;
}> => {
  const { container, foreignTable, foreignPrimary, foreignNumber, foreignDate } = params;
  const baseId = container.baseId.toString();

  const formulaFields = [...params.formulaFields];
  if (!formulaFields.some((field) => field.name === FORMULA_TYPE_FIELD_NAME)) {
    formulaFields.push({ name: FORMULA_TYPE_FIELD_NAME, expression: '10' });
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
  const fields = [
    {
      type: 'singleLineText',
      id: fieldIds.singleLineText,
      name: FIELD_TYPE_NAMES.singleLineText,
      isPrimary: true,
    },
    {
      type: 'longText',
      id: fieldIds.longText,
      name: FIELD_TYPE_NAMES.longText,
    },
    {
      type: 'number',
      id: fieldIds.number,
      name: FIELD_TYPE_NAMES.number,
      options: {
        formatting: { type: 'decimal', precision: 2 },
      },
    },
    {
      type: 'rating',
      id: fieldIds.rating,
      name: FIELD_TYPE_NAMES.rating,
    },
    {
      type: 'singleSelect',
      id: fieldIds.singleSelect,
      name: FIELD_TYPE_NAMES.singleSelect,
    },
    {
      type: 'multipleSelect',
      id: fieldIds.multipleSelect,
      name: FIELD_TYPE_NAMES.multipleSelect,
    },
    {
      type: 'checkbox',
      id: fieldIds.checkbox,
      name: FIELD_TYPE_NAMES.checkbox,
    },
    {
      type: 'attachment',
      id: fieldIds.attachment,
      name: FIELD_TYPE_NAMES.attachment,
    },
    {
      type: 'date',
      id: fieldIds.date,
      name: FIELD_TYPE_NAMES.date,
      options: {
        formatting: DEFAULT_DATE_FORMATTING,
      },
    },
    {
      type: 'createdTime',
      id: fieldIds.createdTime,
      name: FIELD_TYPE_NAMES.createdTime,
      options: {
        formatting: DEFAULT_DATE_FORMATTING,
      },
    },
    {
      type: 'lastModifiedTime',
      id: fieldIds.lastModifiedTime,
      name: FIELD_TYPE_NAMES.lastModifiedTime,
      options: {
        formatting: DEFAULT_DATE_FORMATTING,
      },
    },
    {
      type: 'user',
      id: fieldIds.user,
      name: FIELD_TYPE_NAMES.user,
      options: { isMultiple: true },
    },
    {
      type: 'createdBy',
      id: fieldIds.createdBy,
      name: FIELD_TYPE_NAMES.createdBy,
    },
    {
      type: 'lastModifiedBy',
      id: fieldIds.lastModifiedBy,
      name: FIELD_TYPE_NAMES.lastModifiedBy,
    },
    {
      type: 'autoNumber',
      id: fieldIds.autoNumber,
      name: FIELD_TYPE_NAMES.autoNumber,
    },
    {
      type: 'button',
      id: fieldIds.button,
      name: FIELD_TYPE_NAMES.button,
    },
    {
      type: 'link',
      id: linkFieldId,
      name: FIELD_TYPE_NAMES.link,
      options: {
        relationship: 'manyOne',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignPrimary.id().toString(),
        isOneWay: true,
      },
    },
  ];

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

  // Create multiple lookup fields with different innerField types
  // This allows testing optimization for different innerField types
  const lookupFields = [
    {
      name: FIELD_TYPE_NAMES.lookup, // Default lookup (innerField: singleLineText)
      lookupFieldId: foreignPrimary.id().toString(),
    },
    {
      name: 'LookupNumber', // Lookup with number innerField
      lookupFieldId: foreignNumber.id().toString(),
    },
    {
      name: 'LookupDate', // Lookup with date innerField
      lookupFieldId: foreignDate.id().toString(),
    },
  ];

  for (const lookupField of lookupFields) {
    const lookupCommand = unwrapOrThrow(
      CreateFieldCommand.create({
        baseId,
        tableId: table.id().toString(),
        field: {
          type: 'lookup',
          name: lookupField.name,
          options: {
            linkFieldId,
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: lookupField.lookupFieldId,
          },
        },
      }),
      `CreateFieldCommand(${lookupField.name})`
    );
    table = (await executeCommand<{ table: Table }>(container, lookupCommand)).table;
  }

  const rollupCommand = unwrapOrThrow(
    CreateFieldCommand.create({
      baseId,
      tableId: table.id().toString(),
      field: {
        type: 'rollup',
        name: FIELD_TYPE_NAMES.rollup,
        options: { expression: 'sum({values})', formatting: { type: 'decimal', precision: 2 } },
        config: {
          linkFieldId,
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignNumber.id().toString(),
        },
      },
    }),
    'CreateFieldCommand(RollupType)'
  );
  table = (await executeCommand<{ table: Table }>(container, rollupCommand)).table;

  const nonEmptyCondition = {
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

  const conditionalLookupCommand = unwrapOrThrow(
    CreateFieldCommand.create({
      baseId,
      tableId: table.id().toString(),
      field: {
        type: 'conditionalLookup',
        name: FIELD_TYPE_NAMES.conditionalLookup,
        options: {
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignNumber.id().toString(),
          condition: nonEmptyCondition,
        },
      },
    }),
    'CreateFieldCommand(ConditionalLookupType)'
  );
  table = (await executeCommand<{ table: Table }>(container, conditionalLookupCommand)).table;

  const conditionalRollupCommand = unwrapOrThrow(
    CreateFieldCommand.create({
      baseId,
      tableId: table.id().toString(),
      field: {
        type: 'conditionalRollup',
        name: FIELD_TYPE_NAMES.conditionalRollup,
        options: { expression: 'sum({values})', formatting: { type: 'decimal', precision: 2 } },
        config: {
          foreignTableId: foreignTable.id().toString(),
          lookupFieldId: foreignNumber.id().toString(),
          condition: nonEmptyCondition,
        },
      },
    }),
    'CreateFieldCommand(ConditionalRollupType)'
  );
  table = (await executeCommand<{ table: Table }>(container, conditionalRollupCommand)).table;

  table = await resolveFormulaFields({
    container,
    table,
    formulaFields,
  });

  const fieldsByType = fieldTypeValues.reduce<Record<FieldTypeLiteral, Field>>(
    (acc, type) => {
      acc[type] = findFieldByName(table, FIELD_TYPE_NAMES[type]);
      return acc;
    },
    {} as Record<FieldTypeLiteral, Field>
  );

  const formulaFieldMap = new Map<string, Field>();
  formulaFields.forEach((definition) => {
    formulaFieldMap.set(definition.name, findFieldByName(table, definition.name));
  });

  return { table, fieldsByType, formulaFields: formulaFieldMap };
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

const createHostRecord = async (
  container: IV2NodeTestContainer,
  table: Table,
  fieldsByType: Record<FieldTypeLiteral, Field>,
  foreignRecordId: string
) => {
  const linkValue = { id: foreignRecordId, title: '10' };
  const command = unwrapOrThrow(
    CreateRecordsCommand.create({
      tableId: table.id().toString(),
      records: [
        {
          fields: {
            [fieldsByType.singleLineText.id().toString()]: '10',
            [fieldsByType.longText.id().toString()]: '10',
            [fieldsByType.number.id().toString()]: 10,
            [fieldsByType.rating.id().toString()]: 4,
            [fieldsByType.singleSelect.id().toString()]: '10',
            [fieldsByType.multipleSelect.id().toString()]: ['10', '20'],
            [fieldsByType.checkbox.id().toString()]: true,
            [fieldsByType.attachment.id().toString()]: [
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
            ],
            [fieldsByType.date.id().toString()]: '2024-02-03T00:00:00Z',
            [fieldsByType.user.id().toString()]: [
              { id: 'usr_1', title: '10' },
              { id: 'usr_2', title: '20' },
            ],
            [fieldsByType.button.id().toString()]: null,
            [fieldsByType.link.id().toString()]: linkValue,
          },
        },
      ],
    }),
    'CreateRecordsCommand(HostRecord)'
  );
  await executeCommand(container, command);
};

export const createFormulaTestTable = async (
  container: IV2NodeTestContainer,
  formulaFields: ReadonlyArray<FormulaFieldDefinition>
): Promise<FormulaTestTable> => {
  const formulaDefinitions = new Map(
    formulaFields.map((definition) => [definition.name, definition])
  );
  const foreign = await createForeignTable(container);
  const host = await createHostTable({
    container,
    foreignTable: foreign.table,
    foreignPrimary: foreign.primary,
    foreignNumber: foreign.number,
    foreignDate: foreign.date,
    formulaFields,
  });
  const foreignRecordId = await createForeignRecord(container, foreign.table);
  await createHostRecord(container, host.table, host.fieldsByType, foreignRecordId);

  const translator = new FormulaSqlPgTranslator({
    table: host.table,
    tableAlias: TABLE_ALIAS,
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
    formulaFields: host.formulaFields,
    formulaDefinitions,
    fieldsByType: host.fieldsByType,
    tableAlias: TABLE_ALIAS,
    fieldSnapshotCache: new Map<string, Promise<FieldSnapshotValue>>(),
  };
};

export const executeFormulaAsText = async (
  testTable: FormulaTestTable,
  formulaFieldName: string
): Promise<string | null> => {
  const formulaField = testTable.formulaFields.get(formulaFieldName);
  if (!formulaField) throw new Error(`Missing formula field: ${formulaFieldName}`);
  const sqlExprResult = testTable.translator.resolveFieldById(formulaField.id().toString());
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

type FieldSnapshotValue = {
  fieldName: string;
  fieldType: string;
  formatting?: unknown;
  rawValue: string | null;
  formattedValue: string | null;
};

type FormulaSnapshotContext = {
  formulaName: string;
  formula: string;
  sql: string;
  inputs: Record<string, FieldSnapshotValue>;
  result: string | null;
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

const buildFieldSnapshotValue = async (
  testTable: FormulaTestTable,
  field: Field
): Promise<FieldSnapshotValue> => {
  const rawSql = fetchRawFieldValueSql(field, testTable.tableAlias);
  const formattedSql = buildFormattedFieldValueSql(testTable, field);
  const [rawValue, formattedValue] = await Promise.all([
    fetchSqlValue(testTable, rawSql),
    fetchSqlValue(testTable, formattedSql),
  ]);
  const fieldType = field.type().toString();
  const isTemporalField = fieldType === 'createdTime' || fieldType === 'lastModifiedTime';
  const normalizedRawValue = isTemporalField
    ? normalizeTemporalText(rawValue)
    : fieldType === 'link'
      ? normalizeLinkRawValue(rawValue)
      : rawValue;
  const normalizedFormattedValue = isTemporalField
    ? normalizeTemporalText(formattedValue)
    : formattedValue;
  return {
    fieldName: field.name().toString(),
    fieldType,
    formatting: formatFieldFormatting(field),
    rawValue: normalizedRawValue,
    formattedValue: normalizedFormattedValue,
  };
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
  formulaFieldName: string
): Promise<FormulaSnapshotContext> => {
  const formulaField = testTable.formulaFields.get(formulaFieldName);
  if (!formulaField) throw new Error(`Missing formula field: ${formulaFieldName}`);
  const formulaDefinition = testTable.formulaDefinitions.get(formulaFieldName);
  if (!formulaDefinition) throw new Error(`Missing formula definition: ${formulaFieldName}`);

  const sqlExprResult = testTable.translator.resolveFieldById(formulaField.id().toString());
  const sqlExpr = sqlExprResult._unsafeUnwrap();
  const renderedSql = testTable.translator.renderSql(sqlExpr);
  const result = await fetchSqlValue(testTable, renderedSql);

  const refs = extractFieldRefs(formulaDefinition.expression);
  const inputValues = await Promise.all(
    refs.map(async (ref) => {
      const field = findFieldByName(testTable.table, ref);
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
    formulaName: formulaFieldName,
    formula: formulaDefinition.expression,
    sql: renderedSql,
    inputs: Object.fromEntries(inputValues),
    result: normalizedResult,
  };
};
