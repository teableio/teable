import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';
import type { Field } from '../fields/Field';
import type { FieldId } from '../fields/FieldId';
import { FieldFormVisibilityVisitor } from '../fields/visitors/FieldFormVisibilityVisitor';
import type { ViewType } from './ViewType';

export type ViewColumnMetaEntry = {
  order?: number | null;
  visible?: boolean;
  hidden?: boolean;
  width?: number;
  required?: boolean;
  statisticFunc?: string | null;
  [key: string]: unknown;
};

export type ViewColumnMetaValue = Record<string, ViewColumnMetaEntry>;

export type ViewColumnMetaPatch = {
  readonly fieldId: FieldId;
  readonly columnMeta: ViewColumnMetaEntry;
};

export type ViewColumnMetaChange = {
  readonly fieldId: FieldId;
  readonly previousColumnMeta?: ViewColumnMetaEntry;
  readonly nextColumnMeta: ViewColumnMetaEntry;
};

export const getDefaultViewColumnOrderByFieldId = (
  fields: ReadonlyArray<Field>,
  primaryFieldId: FieldId
): ReadonlyMap<string, number> => {
  const fieldIds = fields.map((field) => field.id());
  const primaryIndex = fieldIds.findIndex((fieldId) => fieldId.equals(primaryFieldId));
  const orderedFieldIds =
    primaryIndex === -1
      ? fieldIds
      : [fieldIds[primaryIndex]!, ...fieldIds.filter((fieldId) => !fieldId.equals(primaryFieldId))];

  return new Map(orderedFieldIds.map((fieldId, index) => [fieldId.toString(), index]));
};

const viewColumnMetaEntrySchema: z.ZodType<ViewColumnMetaEntry> = z.looseObject({
  order: z.number().nullable().optional(),
  visible: z.boolean().optional(),
  hidden: z.boolean().optional(),
  width: z.number().optional(),
  required: z.boolean().optional(),
  statisticFunc: z.string().nullable().optional(),
});

const viewColumnMetaSchema: z.ZodType<ViewColumnMetaValue> = z.record(
  z.string(),
  viewColumnMetaEntrySchema
);

const invalidViewColumnMeta = () =>
  err(domainError.validation({ message: 'Invalid ViewColumnMeta' }));

const parseViewColumnMetaEntry = (entry: unknown): Result<ViewColumnMetaEntry, DomainError> => {
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return invalidViewColumnMeta();
  }
  const source = entry as Record<string, unknown>;
  if (source.order !== undefined && source.order !== null && typeof source.order !== 'number') {
    return invalidViewColumnMeta();
  }
  if (source.visible !== undefined && typeof source.visible !== 'boolean') {
    return invalidViewColumnMeta();
  }
  if (source.hidden !== undefined && typeof source.hidden !== 'boolean') {
    return invalidViewColumnMeta();
  }
  if (source.width !== undefined && typeof source.width !== 'number') {
    return invalidViewColumnMeta();
  }
  if (source.required !== undefined && typeof source.required !== 'boolean') {
    return invalidViewColumnMeta();
  }
  if (
    source.statisticFunc !== undefined &&
    source.statisticFunc !== null &&
    typeof source.statisticFunc !== 'string'
  ) {
    return invalidViewColumnMeta();
  }
  return ok({ ...source });
};

export class ViewColumnMeta extends ValueObject {
  private constructor(private readonly value: ViewColumnMetaValue) {
    super();
  }

  static create(raw: ViewColumnMetaValue): Result<ViewColumnMeta, DomainError> {
    const parsed = viewColumnMetaSchema.safeParse(raw ?? {});
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid ViewColumnMeta',
          details: z.formatError(parsed.error),
        })
      );
    return ok(new ViewColumnMeta(parsed.data));
  }

  static rehydrate(raw: unknown): Result<ViewColumnMeta, DomainError> {
    if (raw == null) return ok(new ViewColumnMeta({}));
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return err(domainError.validation({ message: 'Invalid ViewColumnMeta' }));
    }

    const cloned: ViewColumnMetaValue = {};
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = parseViewColumnMetaEntry(entry);
      if (parsed.isErr()) return err(parsed.error);
      cloned[key] = parsed.value;
    }
    return ok(new ViewColumnMeta(cloned));
  }

  static empty(): ViewColumnMeta {
    return new ViewColumnMeta({});
  }

  static forView(params: {
    viewType: ViewType;
    fields: ReadonlyArray<Field>;
    primaryFieldId: FieldId;
  }): Result<ViewColumnMeta, DomainError> {
    const defaultOrderByFieldId = getDefaultViewColumnOrderByFieldId(
      params.fields,
      params.primaryFieldId
    );
    const columnMeta: ViewColumnMetaValue = {};

    defaultOrderByFieldId.forEach((order, fieldId) => {
      columnMeta[fieldId] = { order };
    });

    const viewType = params.viewType.toString();
    if (viewType === 'form') {
      const visitor = new FieldFormVisibilityVisitor();
      for (const field of params.fields) {
        const visibleResult = field.accept(visitor);
        if (visibleResult.isErr()) return err(visibleResult.error);
        if (!visibleResult.value) continue;
        const key = field.id().toString();
        const previous = columnMeta[key];
        if (!previous) continue;
        columnMeta[key] = { ...previous, visible: true };
      }
      return ViewColumnMeta.create(columnMeta);
    }

    if (viewType === 'kanban' || viewType === 'gallery' || viewType === 'calendar') {
      const key = params.primaryFieldId.toString();
      const previous = columnMeta[key];
      if (previous) {
        columnMeta[key] = { ...previous, visible: true };
      }
    }

    return ViewColumnMeta.create(columnMeta);
  }

  equals(other: ViewColumnMeta): boolean {
    return ViewColumnMeta.isSameValue(this.value, other.value);
  }

  toDto(): ViewColumnMetaValue {
    return ViewColumnMeta.cloneValue(this.value);
  }

  applyPatches(
    patches: ReadonlyArray<ViewColumnMetaPatch>
  ): Result<
    { columnMeta: ViewColumnMeta; changes: ReadonlyArray<ViewColumnMetaChange> },
    DomainError
  > {
    const original = ViewColumnMeta.cloneValue(this.value);
    const next = ViewColumnMeta.cloneValue(this.value);
    const patchedFieldIds = new Map<string, FieldId>();

    for (const patch of patches) {
      const key = patch.fieldId.toString();
      patchedFieldIds.set(key, patch.fieldId);
      next[key] = {
        ...(next[key] ?? {}),
        ...patch.columnMeta,
      };
    }

    const changes: ViewColumnMetaChange[] = [];
    for (const [key, fieldId] of patchedFieldIds) {
      const previousColumnMeta = original[key] ? { ...original[key] } : undefined;
      const nextColumnMeta = { ...(next[key] ?? {}) };
      if (previousColumnMeta && ViewColumnMeta.isSameEntry(previousColumnMeta, nextColumnMeta)) {
        continue;
      }
      changes.push({
        fieldId,
        ...(previousColumnMeta ? { previousColumnMeta } : {}),
        nextColumnMeta,
      });
    }

    return ViewColumnMeta.create(next).map((columnMeta) => ({
      columnMeta,
      changes,
    }));
  }

  private static cloneValue(value: ViewColumnMetaValue): ViewColumnMetaValue {
    return Object.entries(value).reduce<ViewColumnMetaValue>((acc, [key, entry]) => {
      acc[key] = { ...entry };
      return acc;
    }, {});
  }

  private static isSameValue(left: ViewColumnMetaValue, right: ViewColumnMetaValue): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    for (const key of leftKeys) {
      const leftEntry = left[key];
      const rightEntry = right[key];
      if (!rightEntry) return false;
      if (!ViewColumnMeta.isSameEntry(leftEntry, rightEntry)) return false;
    }

    return true;
  }

  private static isSameEntry(left: ViewColumnMetaEntry, right: ViewColumnMetaEntry): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      const leftValue = left[key];
      const rightValue = right[key];
      if (!Object.is(leftValue, rightValue)) return false;
    }

    return true;
  }
}
