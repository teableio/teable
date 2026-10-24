import { z } from 'zod';

export const APP_BUNDLE_FORMAT_VERSION = 1;

const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected a lowercase sha256 hex digest');

export const APP_BUNDLE_CHECKSUM_SCOPES = ['structure', 'seed', 'migrations'] as const;

export const appBundleChecksumsSchema = z.object({
  structure: sha256HexSchema,
  seed: sha256HexSchema,
  migrations: sha256HexSchema,
});

export type AppBundleChecksums = z.infer<typeof appBundleChecksumsSchema>;

export const appBundleManifestSchema = z.object({
  formatVersion: z.literal(APP_BUNDLE_FORMAT_VERSION),
  appId: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  version: z.string().trim().min(1).max(128),
  schemaVersion: z.number().int().positive(),
  minRuntimeVersion: z.string().trim().min(1).max(128).optional(),
  createdAt: z.string().trim().min(1).max(64),
  checksums: appBundleChecksumsSchema,
});

export type AppBundleManifest = z.infer<typeof appBundleManifestSchema>;

const dotTeaTableViewSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
  })
  .passthrough();

const dotTeaTableFieldSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.string().min(1),
  })
  .passthrough();

const dotTeaTableSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    fields: z.array(dotTeaTableFieldSchema).min(1),
    views: z.array(dotTeaTableViewSchema).optional(),
  })
  .passthrough();

type DotTeaTableField = z.infer<typeof dotTeaTableFieldSchema>;

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const hasConditionFilter = (value: Record<string, unknown> | undefined): boolean => {
  const condition = readRecord(value?.condition);
  const filter = readRecord(condition?.filter) ?? readRecord(value?.filter);
  const filterSet = filter?.filterSet;
  return Array.isArray(filterSet) && filterSet.length > 0;
};

const missingRequirements = (
  source: Record<string, unknown> | undefined,
  sourceName: string,
  keys: ReadonlyArray<string>
): string[] =>
  keys
    .filter((key) => {
      const candidate = source?.[key];
      return typeof candidate !== 'string' || candidate.length === 0;
    })
    .map((key) => `${sourceName}.${key}`);

type RelationRequirement = {
  readonly shapeName: string;
  readonly source: Record<string, unknown> | undefined;
  readonly sourceName: 'options' | 'lookupOptions';
  readonly keys: ReadonlyArray<string>;
  readonly requiresCondition: boolean;
};

const lookupWiringKeys = ['foreignTableId', 'linkFieldId', 'lookupFieldId'] as const;

/**
 * The DotTea parser reads relation wiring from fixed keys and silently falls
 * back to `singleLineText` when a key is absent. This maps a field to the keys
 * DotTea actually honors, so an SDK/HTTP field DTO (`options`/`config`) is
 * reported instead of installing a downgraded column.
 */
const resolveRelationRequirement = (field: DotTeaTableField): RelationRequirement | undefined => {
  const options = readRecord(field.options);
  const lookupOptions = readRecord(field.lookupOptions);

  if (field.type === 'conditionalLookup' || field.isConditionalLookup === true) {
    const source = lookupOptions ?? options;
    return {
      shapeName: 'conditionalLookup',
      source,
      sourceName: lookupOptions ? 'lookupOptions' : 'options',
      keys: ['foreignTableId', 'lookupFieldId'],
      requiresCondition: true,
    };
  }
  if (field.type === 'lookup' || field.isLookup === true) {
    return {
      shapeName: 'lookup',
      source: lookupOptions,
      sourceName: 'lookupOptions',
      keys: lookupWiringKeys,
      requiresCondition: false,
    };
  }
  if (field.type === 'link') {
    return {
      shapeName: 'link',
      source: options,
      sourceName: 'options',
      keys: ['relationship', 'foreignTableId', 'lookupFieldId'],
      requiresCondition: false,
    };
  }
  if (field.type === 'rollup') {
    return {
      shapeName: 'rollup',
      source: lookupOptions,
      sourceName: 'lookupOptions',
      keys: lookupWiringKeys,
      requiresCondition: false,
    };
  }
  if (field.type === 'conditionalRollup') {
    return {
      shapeName: 'conditionalRollup',
      source: options,
      sourceName: 'options',
      keys: ['foreignTableId', 'lookupFieldId'],
      requiresCondition: true,
    };
  }
  return undefined;
};

const relationFieldShapeIssue = (field: DotTeaTableField): string | undefined => {
  const requirement = resolveRelationRequirement(field);
  if (!requirement) {
    return undefined;
  }
  const { source, sourceName, shapeName } = requirement;
  const missing = missingRequirements(source, sourceName, requirement.keys);
  if (requirement.requiresCondition && !hasConditionFilter(source)) {
    missing.push(`${sourceName}.condition.filter.filterSet`);
  }
  if (missing.length === 0) {
    return undefined;
  }
  const label = field.name ?? field.id ?? '<unnamed>';
  return (
    `field "${label}" must declare the DotTea ${shapeName} shape: missing ${missing.join(', ')}. ` +
    'The SDK/HTTP field DTO shape (options/config) is rejected because DotTea would install this field as singleLineText.'
  );
};

const readString = (
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const candidate = value?.[key];
  return typeof candidate === 'string' ? candidate : undefined;
};

type DotTeaTable = z.infer<typeof dotTeaTableSchema>;

interface IFieldLocation {
  readonly tableIndex: number;
  readonly tableName: string;
  readonly fieldIndex: number;
  readonly field: DotTeaTableField;
}

interface ITableEntry {
  readonly table: DotTeaTable;
  readonly tableIndex: number;
  readonly fieldsById: ReadonlyMap<string, DotTeaTableField>;
}

const fieldLabel = (field: DotTeaTableField): string => field.name ?? field.id ?? '<unnamed>';

/**
 * DotTea builds a single field-id replacement map for the whole structure, so a
 * duplicate id silently rewires one field to the other's column. Reject both
 * per-table and cross-table duplicates with the conflicting names.
 */
const addDuplicateFieldIdIssues = (
  tables: ReadonlyArray<DotTeaTable>,
  ctx: z.RefinementCtx
): void => {
  const firstById = new Map<string, IFieldLocation>();

  tables.forEach((table, tableIndex) => {
    const seenInTable = new Map<string, IFieldLocation>();
    table.fields.forEach((field, fieldIndex) => {
      if (!field.id) return;
      const location: IFieldLocation = { tableIndex, tableName: table.name, fieldIndex, field };

      const sameTable = seenInTable.get(field.id);
      if (sameTable) {
        ctx.addIssue({
          code: 'custom',
          path: ['tables', tableIndex, 'fields', fieldIndex],
          message:
            `Duplicate field id "${field.id}" in table "${table.name}": ` +
            `field "${fieldLabel(sameTable.field)}" and field "${fieldLabel(field)}" declare the same id. ` +
            'Field ids must be unique within a table because DotTea remaps them through one replacement table.',
        });
        return;
      }
      seenInTable.set(field.id, location);

      const first = firstById.get(field.id);
      if (!first) {
        firstById.set(field.id, location);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['tables', tableIndex, 'fields', fieldIndex],
        message:
          `Duplicate field id "${field.id}" across tables "${first.tableName}" and "${table.name}": ` +
          `field "${fieldLabel(first.field)}" and field "${fieldLabel(field)}" declare the same id. ` +
          'Field ids must be globally unique because DotTea builds one replacement map for the whole structure.',
      });
    });
  });
};

type RelationKind = 'link' | 'lookup' | 'rollup' | 'conditionalLookup' | 'conditionalRollup';

interface IRelationWiring {
  readonly kind: RelationKind;
  readonly source: Record<string, unknown> | undefined;
}

const resolveRelationWiring = (field: DotTeaTableField): IRelationWiring | undefined => {
  const options = readRecord(field.options);
  const lookupOptions = readRecord(field.lookupOptions);

  if (field.type === 'conditionalLookup' || field.isConditionalLookup === true) {
    return { kind: 'conditionalLookup', source: lookupOptions ?? options };
  }
  if (field.type === 'lookup' || field.isLookup === true) {
    return { kind: 'lookup', source: lookupOptions };
  }
  if (field.type === 'link') {
    return { kind: 'link', source: options };
  }
  if (field.type === 'rollup') {
    return { kind: 'rollup', source: lookupOptions };
  }
  if (field.type === 'conditionalRollup') {
    return { kind: 'conditionalRollup', source: options };
  }
  return undefined;
};

const addLinkIssues = (
  location: IFieldLocation,
  source: Record<string, unknown> | undefined,
  tablesById: ReadonlyMap<string, ITableEntry>,
  ctx: z.RefinementCtx
): void => {
  const foreignTableId = readString(source, 'foreignTableId');
  if (!foreignTableId) return;

  const foreignTable = tablesById.get(foreignTableId);
  if (!foreignTable) {
    ctx.addIssue({
      code: 'custom',
      path: ['tables', location.tableIndex, 'fields', location.fieldIndex],
      message:
        `Link field "${fieldLabel(location.field)}" in table "${location.tableName}" ` +
        `references foreign table "${foreignTableId}" which is not declared in this bundle.`,
    });
    return;
  }

  const lookupFieldId = readString(source, 'lookupFieldId');
  if (lookupFieldId && !foreignTable.fieldsById.has(lookupFieldId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['tables', location.tableIndex, 'fields', location.fieldIndex],
      message:
        `Link field "${fieldLabel(location.field)}" in table "${location.tableName}" ` +
        `references field "${lookupFieldId}" which is not in foreign table ` +
        `"${foreignTable.table.name}" ("${foreignTableId}").`,
    });
  }
};

const relationKindLabels: Record<RelationKind, string> = {
  link: 'Link',
  lookup: 'Lookup',
  rollup: 'Rollup',
  conditionalLookup: 'Conditional lookup',
  conditionalRollup: 'Conditional rollup',
};

const addLookupLinkIssues = (
  location: IFieldLocation,
  source: Record<string, unknown> | undefined,
  kindLabel: string,
  hostFieldsById: ReadonlyMap<string, DotTeaTableField>,
  ctx: z.RefinementCtx
): void => {
  const linkFieldId = readString(source, 'linkFieldId');
  if (!linkFieldId) return;

  const path = ['tables', location.tableIndex, 'fields', location.fieldIndex];
  const label = fieldLabel(location.field);
  const linkField = hostFieldsById.get(linkFieldId);
  if (!linkField) {
    ctx.addIssue({
      code: 'custom',
      path,
      message:
        `${kindLabel} field "${label}" in table "${location.tableName}" references link field ` +
        `"${linkFieldId}" which is not in the same table. DotTea requires the link field to live on the host table.`,
    });
    return;
  }

  if (linkField.type !== 'link') {
    ctx.addIssue({
      code: 'custom',
      path,
      message:
        `${kindLabel} field "${label}" in table "${location.tableName}" references field ` +
        `"${fieldLabel(linkField)}" of type "${linkField.type}" in the same table; lookup wiring requires a link field.`,
    });
    return;
  }

  const linkForeignTableId = readString(readRecord(linkField.options), 'foreignTableId');
  const foreignTableId = readString(source, 'foreignTableId');
  if (!linkForeignTableId || !foreignTableId || linkForeignTableId === foreignTableId) return;

  ctx.addIssue({
    code: 'custom',
    path,
    message:
      `${kindLabel} field "${label}" in table "${location.tableName}" declares foreignTableId ` +
      `"${foreignTableId}" but its link field "${fieldLabel(linkField)}" points at "${linkForeignTableId}".`,
  });
};

const addLookupTargetIssues = (
  location: IFieldLocation,
  source: Record<string, unknown> | undefined,
  kindLabel: string,
  tablesById: ReadonlyMap<string, ITableEntry>,
  ctx: z.RefinementCtx
): void => {
  const foreignTableId = readString(source, 'foreignTableId');
  if (!foreignTableId) return;

  const path = ['tables', location.tableIndex, 'fields', location.fieldIndex];
  const label = fieldLabel(location.field);
  const foreignTable = tablesById.get(foreignTableId);
  if (!foreignTable) {
    ctx.addIssue({
      code: 'custom',
      path,
      message:
        `${kindLabel} field "${label}" in table "${location.tableName}" references foreign table ` +
        `"${foreignTableId}" which is not declared in this bundle.`,
    });
    return;
  }

  const lookupFieldId = readString(source, 'lookupFieldId');
  if (!lookupFieldId || foreignTable.fieldsById.has(lookupFieldId)) return;

  ctx.addIssue({
    code: 'custom',
    path,
    message:
      `${kindLabel} field "${label}" in table "${location.tableName}" references field ` +
      `"${lookupFieldId}" which is not in foreign table "${foreignTable.table.name}" ("${foreignTableId}").`,
  });
};

/**
 * Minimal DotTea/TEA structure validation. `@teable/v2-dottea` performs the
 * authoritative parse and normalization during installation; this schema
 * guarantees the bundle is structurally readable and that relation fields
 * declare the shape DotTea will actually honor.
 */
export const appBundleStructureSchema = z
  .object({
    id: z.string().min(1).optional(),
    tables: z.array(dotTeaTableSchema),
  })
  .passthrough()
  .superRefine((structure, ctx) => {
    addDuplicateFieldIdIssues(structure.tables, ctx);

    const tablesById = new Map<string, ITableEntry>(
      structure.tables.flatMap((table, tableIndex) =>
        table.id
          ? [
              [
                table.id,
                {
                  table,
                  tableIndex,
                  fieldsById: new Map(
                    table.fields.flatMap((field) => (field.id ? [[field.id, field] as const] : []))
                  ),
                },
              ] as const,
            ]
          : []
      )
    );

    structure.tables.forEach((table, tableIndex) => {
      const hostFieldsById = new Map(
        table.fields.flatMap((field) => (field.id ? [[field.id, field] as const] : []))
      );
      table.fields.forEach((field, fieldIndex) => {
        const issue = relationFieldShapeIssue(field);
        if (issue) {
          ctx.addIssue({
            code: 'custom',
            message: `table "${table.name}" ${issue}`,
            path: ['tables', tableIndex, 'fields', fieldIndex],
          });
        }

        const wiring = resolveRelationWiring(field);
        if (!wiring) return;
        const location: IFieldLocation = { tableIndex, tableName: table.name, fieldIndex, field };
        if (wiring.kind === 'link') {
          addLinkIssues(location, wiring.source, tablesById, ctx);
        } else {
          const kindLabel = relationKindLabels[wiring.kind];
          addLookupLinkIssues(location, wiring.source, kindLabel, hostFieldsById, ctx);
          addLookupTargetIssues(location, wiring.source, kindLabel, tablesById, ctx);
        }
      });
    });
  });

export type AppBundleStructure = z.infer<typeof appBundleStructureSchema>;
export type AppBundleStructureTable = AppBundleStructure['tables'][number];

export const appBundleSeedRecordSchema = z
  .object({
    fields: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AppBundleSeedRecord = z.infer<typeof appBundleSeedRecordSchema>;

export const appBundleSeedPayloadSchema = z.array(appBundleSeedRecordSchema);

export const formatZodIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ');
