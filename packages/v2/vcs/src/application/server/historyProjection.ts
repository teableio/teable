import type { DomainError, IExecutionContext, IQueryBus } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import { isStoredVcsField } from '../../domain/fieldClassification';
import type {
  IBaseVcsSnapshot,
  IFieldVcsSnapshot,
  ITableVcsSnapshot,
  IViewVcsSnapshot,
} from '../../domain/types';
import type { IVcsHistoryTableScope } from '../../ports/server';
import {
  listSelectedTableRecordsForVcs,
  mapSingleFieldToVcsSnapshot,
} from '../../snapshot/tableToVcsSnapshot';
import { isScopeRecordForbidden } from './serverHelpers';

interface TableVisibility {
  readonly fields: ReadonlySet<string>;
  readonly views: ReadonlySet<string>;
  readonly liveSchema?: Omit<ITableVcsSnapshot, 'records'>;
  readonly includeCheckpointCellTypes?: boolean;
  // A missing row means deleted or inaccessible. A missing key means the live query masked the cell.
  readonly records: ReadonlyMap<string, ReadonlySet<string>>;
}

type HistoryVisibility = ReadonlyMap<string, TableVisibility>;

export async function readHistoryVisibility(
  ctx: IExecutionContext,
  queries: IQueryBus,
  scopes: readonly IVcsHistoryTableScope[],
  snapshots: readonly IBaseVcsSnapshot[]
): Promise<Result<HistoryVisibility, DomainError>> {
  const idsByTable = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    for (const table of snapshot.tables) {
      const ids = idsByTable.get(table.id) ?? new Set<string>();
      for (const record of table.records) ids.add(record.id);
      idsByTable.set(table.id, ids);
    }
  }

  const visible = new Map<string, TableVisibility>();
  for (const scope of scopes) {
    const ids = idsByTable.get(scope.tableId);
    if (!ids || isScopeRecordForbidden(scope)) continue;
    const allowed = scope.readableFieldIds && new Set(scope.readableFieldIds);
    const fields = new Set<string>();
    for (const field of scope.table.getFields()) {
      const id = field.id().toString();
      if (!allowed || allowed.has(id)) fields.add(id);
    }
    if (!fields.size) continue;
    const current = await listSelectedTableRecordsForVcs(
      queries,
      ctx,
      scope.table,
      [...ids],
      scope.queryScope
    );
    if (current.isErr()) return err(current.error);
    if (scope.recordHistoryOnly && !scope.historyFieldsForRecords) continue;
    const historyFields = await scope.historyFieldsForRecords?.(current.value.map((r) => r.id));
    const records = new Map<string, ReadonlySet<string>>();
    const recordFieldIds = scope.recordHistoryOnly ? new Set<string>() : undefined;
    for (const record of current.value) {
      const granted = historyFields?.get(record.id);
      if (scope.historyFieldsForRecords && !granted?.size) continue;
      const keys = Object.keys(record.fields);
      const visibleKeys = granted ? keys.filter((id) => granted.has(id) && fields.has(id)) : keys;
      if (recordFieldIds) {
        if (!visibleKeys.length) continue;
        for (const id of visibleKeys) recordFieldIds.add(id);
      }
      records.set(record.id, new Set(visibleKeys));
    }
    if (recordFieldIds) {
      const primaryFieldId = scope.table.primaryFieldId().toString();
      if (!records.size || !fields.has(primaryFieldId)) continue;
      // A checkout needs a primary column even if none of its cells carry a history grant.
      recordFieldIds.add(primaryFieldId);
      const liveFields: IFieldVcsSnapshot[] = [];
      for (const field of scope.table.getFields()) {
        const id = field.id().toString();
        if (!recordFieldIds.has(id)) continue;
        if (snapshots.length > 1) {
          // Both endpoints need the same stored column for comparing raw cell values,
          // even if the live field has since become computed.
          liveFields.push({
            id,
            name: field.name().toString(),
            type: 'singleLineText',
            isPrimary: id === primaryFieldId,
            isComputed: false,
          });
          continue;
        }
        const mapped = mapSingleFieldToVcsSnapshot(scope.table, field);
        if (mapped.isErr()) return err(mapped.error);
        liveFields.push(fieldMetadata(mapped.value));
      }
      visible.set(scope.tableId, {
        fields: recordFieldIds,
        views: scope.readableViewIds,
        records,
        includeCheckpointCellTypes: snapshots.length === 1,
        liveSchema: {
          id: scope.tableId,
          name: scope.table.name().toString(),
          primaryFieldId,
          fields: liveFields,
          views: [],
        },
      });
      continue;
    }
    visible.set(scope.tableId, {
      fields,
      views: scope.readableViewIds,
      records,
    });
  }
  return ok(visible);
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function referencesOutside(value: unknown, baseId: string, tables: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((v) => referencesOutside(v, baseId, tables));
  if (!object(value)) return false;
  return Object.entries(value).some(([key, v]) => {
    if ((key === 'baseId' || key === 'foreignBaseId') && v != null) return v !== baseId;
    if ((key === 'tableId' || key === 'foreignTableId') && v != null)
      return typeof v !== 'string' || !tables.has(v);
    return referencesOutside(v, baseId, tables);
  });
}

export function containsForeignReferences(snapshot: IBaseVcsSnapshot): boolean {
  const tables = new Set(snapshot.tables.map((table) => table.id));
  return snapshot.tables.some(
    (table) =>
      table.fields.some(
        (field) =>
          (field.type === 'link' && typeof field.options?.foreignTableId !== 'string') ||
          referencesOutside(field.options, snapshot.baseId, tables) ||
          referencesOutside(field.aiConfig, snapshot.baseId, tables)
      ) || table.views.some((view) => referencesOutside(view, snapshot.baseId, tables))
  );
}

// Defaults, prompts, expressions and predicates can contain literal values. Scoped
// checkouts only carry scalar options that describe how an authorized field is read.
const scalarOptionKeys: Readonly<Record<string, readonly string[]>> = {
  number: ['formatting'],
  date: ['formatting'],
  rating: ['icon', 'color', 'max'],
  user: ['isMultiple'],
};

function fieldMetadata(field: IFieldVcsSnapshot): IFieldVcsSnapshot {
  const { id, name, type, isPrimary, isComputed, isLookup, isConditionalLookup, notNull, unique } =
    field;
  const options = Object.fromEntries(
    (isStoredVcsField(field) ? (scalarOptionKeys[type] ?? []) : []).flatMap((key) =>
      field.options?.[key] === undefined ? [] : [[key, field.options[key]]]
    )
  );
  return {
    id,
    name,
    type,
    isPrimary,
    isComputed,
    isLookup,
    isConditionalLookup,
    notNull,
    unique,
    ...(Object.keys(options).length ? { options } : {}),
  };
}

function referencesField(value: unknown, fields: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return fields.has(value);
  if (Array.isArray(value)) return value.some((v) => referencesField(v, fields));
  return (
    object(value) &&
    Object.entries(value).some(([key, v]) => fields.has(key) || referencesField(v, fields))
  );
}

function ownerView(
  view: IViewVcsSnapshot,
  baseId: string,
  tables: ReadonlySet<string>,
  redactedFields: ReadonlySet<string>
): IViewVcsSnapshot {
  const safe = (v: unknown) =>
    !referencesOutside(v, baseId, tables) && !referencesField(v, redactedFields);
  const { options, query, columnMeta, ...properties } = view;
  let visibleOptions = options;
  if (options && !safe(options)) {
    // These grid presentation settings do not depend on a linked field or target.
    visibleOptions =
      view.type === 'grid'
        ? Object.fromEntries(
            Object.entries(options).filter(
              ([key, value]) =>
                (key === 'rowHeight' && typeof value === 'string') ||
                ((key === 'fieldNameDisplayLines' || key === 'frozenColumnCount') &&
                  typeof value === 'number')
            )
          )
        : undefined;
  }
  return {
    ...properties,
    ...(visibleOptions && Object.keys(visibleOptions).length ? { options: visibleOptions } : {}),
    ...(query
      ? { query: Object.fromEntries(Object.entries(query).filter(([, v]) => safe(v))) }
      : {}),
    ...(columnMeta
      ? { columnMeta: Object.fromEntries(Object.entries(columnMeta).filter(([, v]) => safe(v))) }
      : {}),
  };
}

function projectLink(value: unknown, rows: ReadonlySet<string> | undefined): unknown {
  const item = (v: unknown) => {
    const id = typeof v === 'string' ? v : object(v) ? v.id : undefined;
    // Stored titles can come from a masked or previously different primary field.
    return typeof id === 'string' && rows?.has(id) ? { id } : undefined;
  };
  if (!Array.isArray(value)) return item(value);
  const items = value.flatMap((v) => item(v) ?? []);
  return items.length ? items : undefined;
}

function project(
  snapshot: IBaseVcsSnapshot,
  visibility?: HistoryVisibility,
  baseName = snapshot.baseName
): IBaseVcsSnapshot {
  const tableIds = new Set(snapshot.tables.map((table) => table.id));
  const rowsByTable = new Map<string, Set<string>>();
  for (const table of snapshot.tables) {
    const scope = visibility?.get(table.id);
    // primaryFieldId is required by the snapshot format and must itself be disclosable.
    if (visibility && !scope?.liveSchema && !scope?.fields.has(table.primaryFieldId)) continue;
    rowsByTable.set(
      table.id,
      new Set(table.records.filter((r) => !scope || scope.records.has(r.id)).map((r) => r.id))
    );
  }
  const tables: ITableVcsSnapshot[] = [];
  for (const table of snapshot.tables) {
    const rows = rowsByTable.get(table.id);
    if (!rows) continue;
    const scope = visibility?.get(table.id);
    const fields = table.fields.filter((f) => !scope || scope.fields.has(f.id));
    const stored = fields.filter(isStoredVcsField);
    const links = new Map(
      stored
        .filter((f) => f.type === 'link')
        .map((f) => {
          const target = f.options?.foreignTableId;
          const local =
            typeof target === 'string' && !referencesOutside(f.options, snapshot.baseId, tableIds);
          return [f.id, local ? rowsByTable.get(target) : undefined] as const;
        })
    );
    const redactedFields = new Set(
      fields
        .filter(
          (field) =>
            !isStoredVcsField(field) ||
            (field.type === 'link' && !links.get(field.id)) ||
            referencesOutside(field.options, snapshot.baseId, tableIds)
        )
        .map((field) => field.id)
    );
    const schema = scope?.liveSchema ?? {
      id: table.id,
      name: table.name,
      primaryFieldId: table.primaryFieldId,
      ...(!scope && table.dbTableName !== undefined ? { dbTableName: table.dbTableName } : {}),
      fields: fields.map((field) => {
        if (
          scope ||
          redactedFields.has(field.id) ||
          referencesOutside(field.aiConfig, snapshot.baseId, tableIds)
        ) {
          return fieldMetadata(field);
        }
        return field;
      }),
      views: table.views
        .filter((v) => !scope || scope.views.has(v.id))
        .map((v) =>
          scope
            ? { id: v.id, name: v.name, type: v.type }
            : ownerView(v, snapshot.baseId, tableIds, redactedFields)
        ),
    };
    // A record-history grant reveals the type of a returned cell. It does not
    // reveal the old field name, constraints, options, or types of masked cells.
    const cellTypes = scope?.includeCheckpointCellTypes ? new Map<string, string>() : undefined;
    const records = table.records
      .filter((r) => rows.has(r.id))
      .map((record) => {
        const cells: Record<string, unknown> = {};
        const currentKeys = scope?.records.get(record.id);
        for (const field of stored) {
          if (currentKeys && !currentKeys.has(field.id)) continue;
          const value = record.fields[field.id];
          const safe = links.has(field.id) ? projectLink(value, links.get(field.id)) : value;
          if (safe === undefined) continue;
          cells[field.id] = safe;
          if (safe !== null) cellTypes?.set(field.id, field.type);
        }
        return scope ? { id: record.id, fields: cells } : { ...record, fields: cells };
      });
    tables.push({
      ...schema,
      fields: cellTypes?.size
        ? schema.fields.map((field) => {
            const type = cellTypes.get(field.id);
            if (!type) return field;
            const { id, name, isPrimary } = field;
            return { id, name, isPrimary, type, isComputed: false };
          })
        : schema.fields,
      records,
    });
  }
  // Both sides of a record-only comparison use the same live schema, even when the
  // table did not yet exist in one revision. Only the admitted records can differ.
  if (visibility) {
    for (const [id, scope] of visibility) {
      if (scope.liveSchema && !tableIds.has(id)) tables.push({ ...scope.liveSchema, records: [] });
    }
  }
  return {
    formatVersion: snapshot.formatVersion,
    baseId: snapshot.baseId,
    baseName,
    revision: snapshot.revision,
    capturedAt: snapshot.capturedAt,
    tables,
    accessScope: {
      tables: Object.fromEntries(
        tables.map((t) => [
          t.id,
          {
            tableId: t.id,
            readableFieldIds: t.fields.map((f) => f.id),
            isRowFiltered: true,
          },
        ])
      ),
    },
  };
}

export function projectBaseOnlySnapshot(
  snapshot: IBaseVcsSnapshot,
  redact = containsForeignReferences(snapshot)
): IBaseVcsSnapshot {
  return redact ? project(snapshot) : snapshot;
}

export function projectHistoricalSnapshot(
  snapshot: IBaseVcsSnapshot,
  visibility: HistoryVisibility,
  currentBaseName?: string
): IBaseVcsSnapshot {
  return project(snapshot, visibility, currentBaseName);
}
