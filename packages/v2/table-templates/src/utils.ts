import type { ICreateTableRequestDto } from '@teable/v2-contract-http';
import { FieldId, RecordId, SelectOptionId, TableId, type FieldColorValue } from '@teable/v2-core';

import type {
  CreateTableTemplateInputOptions,
  SingleTableSeed,
  TableTemplateDefinition,
  TableTemplateTablePreview,
  TemplateRecord,
  TemplateSeed,
} from './types';

export const MIN_TEMPLATE_RECORDS = 5;
export const MAX_TEMPLATE_RECORDS = 100;

export const createFieldId = (): string => FieldId.mustGenerate().toString();

export const createRecordId = (): string => {
  const idResult = RecordId.generate();
  if (idResult.isOk()) return idResult.value.toString();
  const fallback = Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  return `rec${fallback}`;
};

export const createTableId = (): string => {
  const idResult = TableId.generate();
  if (idResult.isOk()) return idResult.value.toString();
  const fallback = Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  return `tbl${fallback}`;
};

export const createSelectOptionId = (): string => {
  const idResult = SelectOptionId.generate();
  if (idResult.isOk()) return idResult.value.toString();
  const fallback = Math.random().toString(36).slice(2, 10).padEnd(8, '0').slice(0, 8);
  return `cho${fallback}`;
};

export const createSelectOption = (name: string, color: FieldColorValue) => ({
  id: createSelectOptionId(),
  name,
  color,
});

export const normalizeTemplateRecords = (
  records: ReadonlyArray<TemplateRecord>,
  recordCount: number
): ReadonlyArray<TemplateRecord> => {
  if (recordCount <= 0) return [];
  if (records.length >= recordCount) return records.slice(0, recordCount);
  const missing = recordCount - records.length;
  if (records.length === 0) {
    return Array.from({ length: recordCount }, () => ({ fields: {} }));
  }
  const extraRecords = Array.from({ length: missing }, (_, index) => {
    const record = records[index % records.length];
    const { fields } = record;
    return { fields: { ...fields } };
  });
  return [...records, ...extraRecords];
};

export const resolveTemplateRecordCount = (
  records?: ReadonlyArray<TemplateRecord>,
  defaultRecordCount?: number
): number => {
  if (!records || records.length === 0) return 0;
  const desiredCount = defaultRecordCount ?? records.length;
  return Math.min(MAX_TEMPLATE_RECORDS, Math.max(MIN_TEMPLATE_RECORDS, desiredCount));
};

export const createTemplate = (
  key: string,
  name: string,
  description: string,
  buildSeed: () => TemplateSeed,
  defaultRecordCount?: number
): TableTemplateDefinition => ({
  ...(() => {
    const previewSeed = buildSeed();
    const previewTables: TableTemplateTablePreview[] = previewSeed.tables.map((table) => ({
      key: table.key,
      name: table.name,
      description: table.description,
      fieldCount: table.fields.length,
      defaultRecordCount: resolveTemplateRecordCount(table.records, table.defaultRecordCount),
    }));

    const totalSeedRecords = previewTables.reduce(
      (sum, table) => sum + table.defaultRecordCount,
      0
    );

    return {
      key,
      name,
      description,
      defaultRecordCount: defaultRecordCount ?? totalSeedRecords,
      tables: previewTables,
      createInput: (baseId: string, options?: CreateTableTemplateInputOptions) => {
        const seed = buildSeed();
        const includeRecords = options?.includeRecords ?? false;
        const namePrefix = options?.namePrefix?.trim();
        const isMultiTable = seed.tables.length > 1;

        return {
          baseId,
          tables: seed.tables.map((table) => {
            const seedRecords = table.records;
            const canIncludeRecords = Boolean(
              (seedRecords && seedRecords.length > 0) || table.buildRecords
            );
            const recordCount = resolveTemplateRecordCount(seedRecords, table.defaultRecordCount);
            const records = (() => {
              if (!includeRecords || !canIncludeRecords || recordCount <= 0) return undefined;
              // Use buildRecords if provided, otherwise normalize static records
              if (table.buildRecords) {
                return [...table.buildRecords(recordCount)];
              }
              return [...normalizeTemplateRecords(seedRecords ?? [], recordCount)];
            })();
            const resolvedName = (() => {
              if (!namePrefix) return table.name;
              if (!isMultiTable) return namePrefix;
              return `${namePrefix} - ${table.name}`;
            })();

            return {
              ...(table.tableId ? { tableId: table.tableId } : {}),
              name: resolvedName,
              fields: table.fields,
              ...(records ? { records } : {}),
            };
          }),
        };
      },
    };
  })(),
});

export const singleTable = (
  key: string,
  name: string,
  description: string,
  buildSeed: () => SingleTableSeed,
  defaultRecordCount?: number
): TableTemplateDefinition =>
  createTemplate(
    key,
    name,
    description,
    () => ({
      tables: (() => {
        const seed = buildSeed();
        return [
          {
            key: 'main',
            name,
            description,
            fields: seed.fields,
            records: seed.records,
            defaultRecordCount: seed.defaultRecordCount,
          },
        ];
      })(),
    }),
    defaultRecordCount
  );

export const createTextColumns = (count: number): ICreateTableRequestDto['fields'] =>
  Array.from({ length: count }, (_, i) => ({
    type: 'singleLineText' as const,
    id: createFieldId(),
    name: `Column ${i + 1}`,
  }));
