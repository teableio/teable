import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Repro structure export.
 *
 * The shape mirrors `structure.json` produced by the v2 base export
 * (`community/apps/nestjs-backend/src/features/base/base-export-v2.service.ts`).
 * Only the sections the DotTea parser and the computed pipeline need are read:
 * `base`, `table_meta`, `field`, `view`. Folders/nodes/plugins/workflows carry no
 * table semantics and are not exported.
 */
export type ReproStructureField = {
  id?: string;
  name?: string;
  type: string;
  options?: Record<string, unknown> | null;
  lookupOptions?: Record<string, unknown> | null;
  isLookup?: boolean;
  isConditionalLookup?: boolean;
  isPrimary?: boolean;
  dbFieldName?: string;
  dbFieldType?: string;
  cellValueType?: string;
  isMultipleCellValue?: boolean;
  notNull?: boolean;
  unique?: boolean;
  order?: number;
  description?: string;
  meta?: unknown;
  aiConfig?: unknown;
  createdTime?: string;
  hasError?: boolean;
};

export type ReproStructureView = {
  id?: string;
  name?: string;
  type?: string;
  order?: number;
  [key: string]: unknown;
};

export type ReproStructureTable = {
  id?: string;
  name: string;
  order?: number;
  description?: string;
  icon?: string;
  dbTableName?: string;
  fields: ReproStructureField[];
  views?: ReproStructureView[];
};

export type ReproStructure = {
  id?: string;
  name?: string;
  icon?: string | null;
  version?: string;
  tables: ReproStructureTable[];
};

export type ReproIdMap = {
  base?: { id: string; name: string };
  tables: Record<string, string>;
  fields: Record<string, string>;
  views: Record<string, string>;
  /** Structure paths whose literal values were replaced to keep cell data out of the artifact. */
  scrubbedPaths: string[];
};

export type ExtractedStructure = {
  structure: ReproStructure;
  idMap: ReproIdMap;
};

type BaseRow = { id: string; name: string; icon: string | null };
type TableRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  db_table_name: string;
  order: number;
};
type FieldRow = {
  id: string;
  name: string;
  description: string | null;
  options: string | null;
  meta: string | null;
  ai_config: string | null;
  type: string;
  cell_value_type: string;
  is_multiple_cell_value: boolean | null;
  db_field_type: string;
  db_field_name: string;
  not_null: boolean | null;
  unique: boolean | null;
  is_primary: boolean | null;
  is_lookup: boolean | null;
  is_conditional_lookup: boolean | null;
  has_error: boolean | null;
  lookup_options: string | null;
  table_id: string;
  order: number;
  created_time: Date | string;
};
type ViewRow = {
  id: string;
  name: string;
  description: string | null;
  table_id: string;
  type: string;
  sort: string | null;
  filter: string | null;
  group: string | null;
  options: string | null;
  column_meta: string | null;
  enable_share: boolean | null;
  share_meta: string | null;
  share_id: string | null;
  is_locked: boolean | null;
  order: number;
};

const parseJson = (value: string | null | undefined): unknown =>
  value ? (JSON.parse(value) as unknown) : undefined;

const parseJsonOrNull = (value: string | null | undefined): unknown =>
  value ? (JSON.parse(value) as unknown) : null;

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export type ReproStructureSourceDb = Kysely<V1TeableDatabase>;

/**
 * Read-only metadata export. The queries mirror the base export v2 service and
 * only select columns; nothing is written to the source database.
 */
export const extractBaseStructure = async (
  db: ReproStructureSourceDb,
  baseId: string
): Promise<ExtractedStructure> => {
  const baseResult = await sql<BaseRow>`
    select "id", "name", "icon"
    from "base"
    where "id" = ${baseId}
      and "deleted_time" is null
    limit 1
  `.execute(db);
  const base = baseResult.rows[0];
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  const tablesResult = await sql<TableRow>`
    select "id", "name", "description", "icon", "db_table_name", "order"
    from "table_meta"
    where "base_id" = ${baseId}
      and "deleted_time" is null
    order by "order" asc
  `.execute(db);
  const fieldsResult = await sql<FieldRow>`
    select f.*
    from "field" f
    inner join "table_meta" t on t."id" = f."table_id"
    where t."base_id" = ${baseId}
      and t."deleted_time" is null
      and f."deleted_time" is null
    order by f."order" asc
  `.execute(db);
  const viewsResult = await sql<ViewRow>`
    select v.*
    from "view" v
    inner join "table_meta" t on t."id" = v."table_id"
    where t."base_id" = ${baseId}
      and t."deleted_time" is null
      and v."deleted_time" is null
    order by v."order" asc
  `.execute(db);

  const tables = tablesResult.rows.map((table) => ({
    id: table.id,
    name: table.name,
    order: table.order,
    ...(table.description ? { description: table.description } : {}),
    ...(table.icon ? { icon: table.icon } : {}),
    dbTableName: table.db_table_name.split('.').pop(),
  }));

  const fieldsByTable = new Map<string, FieldRow[]>();
  for (const field of fieldsResult.rows) {
    const list = fieldsByTable.get(field.table_id) ?? [];
    list.push(field);
    fieldsByTable.set(field.table_id, list);
  }
  const viewsByTable = new Map<string, ViewRow[]>();
  for (const view of viewsResult.rows) {
    const list = viewsByTable.get(view.table_id) ?? [];
    list.push(view);
    viewsByTable.set(view.table_id, list);
  }

  const structure: ReproStructure = {
    id: base.id,
    name: base.name,
    icon: base.icon,
    tables: tables.map((table) => ({
      ...table,
      fields: (fieldsByTable.get(table.id!) ?? []).map((field): ReproStructureField => ({
        id: field.id,
        name: field.name,
        ...(field.description ? { description: field.description } : {}),
        type: field.type,
        options: parseJson(field.options) as Record<string, unknown> | null | undefined,
        dbFieldName: field.db_field_name,
        ...(field.not_null != null ? { notNull: field.not_null } : {}),
        ...(field.unique != null ? { unique: field.unique } : {}),
        ...(field.is_primary != null ? { isPrimary: field.is_primary } : {}),
        ...(field.has_error != null ? { hasError: field.has_error } : {}),
        order: field.order,
        lookupOptions: parseJson(field.lookup_options) as Record<string, unknown> | null,
        ...(field.is_lookup != null ? { isLookup: field.is_lookup } : {}),
        ...(field.is_conditional_lookup != null
          ? { isConditionalLookup: field.is_conditional_lookup }
          : {}),
        aiConfig: parseJson(field.ai_config),
        meta: parseJson(field.meta),
        dbFieldType: field.db_field_type,
        cellValueType: field.cell_value_type,
        ...(field.is_multiple_cell_value != null
          ? { isMultipleCellValue: field.is_multiple_cell_value }
          : {}),
        createdTime: toIsoString(field.created_time),
      })),
      views: (viewsByTable.get(table.id!) ?? []).map((view): ReproStructureView => ({
        id: view.id,
        name: view.name,
        ...(view.description ? { description: view.description } : {}),
        type: view.type,
        sort: parseJson(view.sort),
        filter: parseJson(view.filter),
        group: parseJson(view.group),
        options: parseJson(view.options),
        columnMeta: parseJsonOrNull(view.column_meta),
        ...(view.enable_share != null ? { enableShare: view.enable_share } : {}),
        shareMeta: parseJson(view.share_meta),
        ...(view.share_id != null ? { shareId: view.share_id } : {}),
        ...(view.is_locked != null ? { isLocked: view.is_locked } : {}),
        order: view.order,
      })),
    })),
  };

  return {
    structure,
    idMap: {
      base: { id: base.id, name: base.name },
      tables: {},
      fields: {},
      views: {},
      scrubbedPaths: [],
    },
  };
};

const scrubFilterValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(() => scrubFilterValue(value[0]));
  if (typeof value === 'number' || typeof value === 'bigint') return 0;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string') return '';
  return null;
};

const scrubConditionValues = (node: unknown, path: string, idMap: ReproIdMap): void => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => scrubConditionValues(entry, `${path}[${index}]`, idMap));
    return;
  }
  const record = node as Record<string, unknown>;
  const filterSet = record.filterSet;
  if (Array.isArray(filterSet)) {
    filterSet.forEach((condition, index) => {
      const conditionRecord = asRecord(condition);
      if (!conditionRecord) return;
      if (Object.prototype.hasOwnProperty.call(conditionRecord, 'value')) {
        conditionRecord.value = scrubFilterValue(conditionRecord.value);
        idMap.scrubbedPaths.push(`${path}.filterSet[${index}].value`);
      }
      const nested = conditionRecord.filter;
      if (nested) scrubConditionValues(nested, `${path}.filterSet[${index}].filter`, idMap);
    });
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'filterSet') continue;
    if (value && typeof value === 'object') {
      scrubConditionValues(value, `${path}.${key}`, idMap);
    }
  }
};

const sanitizeOptions = (
  options: Record<string, unknown> | null | undefined,
  path: string,
  choiceNames: Map<string, string>,
  idMap: ReproIdMap
): Record<string, unknown> | null | undefined => {
  if (!options) return options;
  const cloned = JSON.parse(JSON.stringify(options)) as Record<string, unknown>;

  const choices = cloned.choices;
  if (Array.isArray(choices)) {
    for (const [index, choice] of choices.entries()) {
      const record = asRecord(choice);
      if (!record) continue;
      if (typeof record.name === 'string') {
        const pseudonym = choiceNames.get(`${path}.choices[${index}]`) ?? `Choice_${index + 1}`;
        choiceNames.set(`${path}.choices[${index}]`, pseudonym);
        idMap.fields[`${path}.choices[${index}].name`] = record.name;
        record.name = pseudonym;
      }
    }
  }

  scrubConditionValues(cloned, path, idMap);
  return cloned;
};

/**
 * Replace every display name with a deterministic pseudonym and drop sections
 * that carry customer content (descriptions, view filters/sorts/column meta,
 * AI config, field meta). The id -> original name map is returned separately;
 * callers must write it to its own file and never into the repro artifact.
 */
export const sanitizeStructure = (structure: ReproStructure): ExtractedStructure => {
  const idMap: ReproIdMap = {
    base: structure.id ? { id: structure.id, name: structure.name ?? '' } : undefined,
    tables: {},
    fields: {},
    views: {},
    scrubbedPaths: [],
  };
  const choiceNames = new Map<string, string>();
  let fieldIndex = 0;
  let viewIndex = 0;

  const tables = structure.tables.map((table, tableIndex) => {
    const tableName = `Table_${tableIndex + 1}`;
    if (table.id) idMap.tables[table.id] = table.name;

    return {
      ...table,
      name: tableName,
      ...(table.id ? { id: table.id } : {}),
      dbTableName: `table_${tableIndex + 1}`,
      description: undefined,
      icon: undefined,
      fields: table.fields.map((field) => {
        fieldIndex += 1;
        const fieldName = `Field_${fieldIndex}`;
        if (field.id) idMap.fields[field.id] = field.name ?? '';
        const fieldPath = `${table.id ?? tableIndex}.${field.id ?? fieldIndex}`;
        return {
          ...field,
          name: fieldName,
          description: undefined,
          meta: undefined,
          aiConfig: undefined,
          dbFieldName: `field_${fieldIndex}`,
          options: sanitizeOptions(field.options, `${fieldPath}.options`, choiceNames, idMap),
          lookupOptions: sanitizeOptions(
            field.lookupOptions,
            `${fieldPath}.lookupOptions`,
            choiceNames,
            idMap
          ),
        };
      }),
      views: (table.views ?? []).map((view) => {
        viewIndex += 1;
        if (view.id) idMap.views[view.id] = view.name ?? '';
        return {
          ...(view.id ? { id: view.id } : {}),
          name: `View_${viewIndex}`,
          type: view.type,
          order: view.order,
        };
      }),
    };
  });

  const sanitized: ReproStructure = {
    ...(structure.id ? { id: structure.id } : {}),
    name: 'Repro Base',
    icon: null,
    ...(structure.version ? { version: structure.version } : {}),
    tables,
  };

  return { structure: sanitized, idMap };
};
