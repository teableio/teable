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

  static empty(): ViewColumnMeta {
    return new ViewColumnMeta({});
  }

  static forView(params: {
    viewType: ViewType;
    fields: ReadonlyArray<Field>;
    primaryFieldId: FieldId;
  }): Result<ViewColumnMeta, DomainError> {
    const orderedFieldIds = ViewColumnMeta.orderFieldIds(params.fields, params.primaryFieldId);
    const columnMeta: ViewColumnMetaValue = {};

    orderedFieldIds.forEach((fieldId, index) => {
      columnMeta[fieldId.toString()] = { order: index };
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

  private static orderFieldIds(
    fields: ReadonlyArray<Field>,
    primaryFieldId: FieldId
  ): ReadonlyArray<FieldId> {
    const fieldIds = fields.map((field) => field.id());
    const primaryIndex = fieldIds.findIndex((fieldId) => fieldId.equals(primaryFieldId));
    if (primaryIndex === -1) return fieldIds;

    return [
      fieldIds[primaryIndex],
      ...fieldIds.filter((fieldId) => !fieldId.equals(primaryFieldId)),
    ];
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
