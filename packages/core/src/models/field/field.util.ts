import type { ISetFieldPropertyOpContext } from '../../op-builder/field/set-field-property';
import { FieldType } from './constant';
import type { FormulaFieldCore, LinkFieldCore } from './derivate';
import type { FieldCore } from './field';
import type { IFieldVo } from './field.schema';
import type { IFieldWithExpression } from './field.type';

export function isFormulaField(field: FieldCore): field is FormulaFieldCore {
  return field.type === FieldType.Formula;
}

export function isLinkField(field: FieldCore): field is LinkFieldCore {
  return field.type === FieldType.Link && !field.isLookup;
}

export function isFieldHasExpression(field: FieldCore): field is IFieldWithExpression {
  return (
    isFormulaField(field) ||
    field.type === FieldType.AutoNumber ||
    field.type === FieldType.LastModifiedTime ||
    field.type === FieldType.CreatedTime
  );
}

/**
 * Returns true when the field reaches into a different base, either as a direct
 * cross-base link or as a lookup / rollup whose underlying link points to another
 * base. Operates on the field VO so it can run on the frontend and the backend.
 */
export function isCrossBaseField(
  field: Pick<IFieldVo, 'type' | 'options' | 'lookupOptions'>,
  currentBaseId: string | undefined
): boolean {
  if (field.type === FieldType.Link) {
    const linkBaseId = (field.options as { baseId?: string } | undefined)?.baseId;
    if (linkBaseId && (!currentBaseId || linkBaseId !== currentBaseId)) return true;
  }

  const lookupOptions = field.lookupOptions;
  const lookupBaseId = lookupOptions?.baseId;
  if (lookupBaseId && (!currentBaseId || lookupBaseId !== currentBaseId)) return true;

  return false;
}

export function hasCrossBaseField(
  fields: Pick<IFieldVo, 'type' | 'options' | 'lookupOptions'>[],
  currentBaseId: string | undefined
): boolean {
  return fields.some((field) => isCrossBaseField(field, currentBaseId));
}

/**
 * Whether an explicit AI action (single-cell generate / field auto-fill) may
 * target this field.
 *
 * Computed fields — lookup, conditional lookup, formula, rollup — can carry an
 * inherited `aiConfig` copy on their row (v1 create, snapshot rehydrate,
 * duplicate), which is enough for the AI entry points to treat them as AI
 * fields. Their cells are read-only projections, so a generation task started
 * for them can never write its result back. Backend validates with the same
 * predicate; keep both sides aligned.
 */
export function isAiActionWritableField(field: {
  aiConfig?: unknown;
  isComputed?: boolean | null;
  isLookup?: boolean | null;
  isConditionalLookup?: boolean | null;
}): boolean {
  if (!field.aiConfig) return false;
  return !field.isComputed && !field.isLookup && !field.isConditionalLookup;
}

/**
 * Apply a single field property operation to a field VO.
 * This is a helper function that handles type-safe property assignment.
 */
function applyFieldPropertyOperation(
  fieldVo: IFieldVo,
  key: ISetFieldPropertyOpContext['key'],
  newValue: unknown
): IFieldVo {
  switch (key) {
    case 'type':
      return { ...fieldVo, type: newValue as IFieldVo['type'] };
    case 'name':
      return { ...fieldVo, name: newValue as string };
    case 'description':
      return { ...fieldVo, description: newValue as string | undefined };
    case 'options':
      return { ...fieldVo, options: newValue as IFieldVo['options'] };
    case 'meta':
      return { ...fieldVo, meta: newValue as IFieldVo['meta'] };
    case 'aiConfig':
      return { ...fieldVo, aiConfig: newValue as IFieldVo['aiConfig'] };
    case 'notNull':
      return { ...fieldVo, notNull: newValue as boolean | undefined };
    case 'unique':
      return { ...fieldVo, unique: newValue as boolean | undefined };
    case 'isPrimary':
      return { ...fieldVo, isPrimary: newValue as boolean | undefined };
    case 'isComputed':
      return { ...fieldVo, isComputed: newValue as boolean | undefined };
    case 'isPending':
      return { ...fieldVo, isPending: newValue as boolean | undefined };
    case 'hasError':
      return { ...fieldVo, hasError: newValue as boolean | undefined };
    case 'isLookup':
      return { ...fieldVo, isLookup: newValue as boolean | undefined };
    case 'isConditionalLookup':
      return { ...fieldVo, isConditionalLookup: newValue as boolean | undefined };
    case 'lookupOptions':
      return { ...fieldVo, lookupOptions: newValue as IFieldVo['lookupOptions'] };
    case 'cellValueType':
      return { ...fieldVo, cellValueType: newValue as IFieldVo['cellValueType'] };
    case 'isMultipleCellValue':
      return { ...fieldVo, isMultipleCellValue: newValue as boolean | undefined };
    case 'dbFieldType':
      return { ...fieldVo, dbFieldType: newValue as IFieldVo['dbFieldType'] };
    case 'dbFieldName':
      return { ...fieldVo, dbFieldName: newValue as string };
    case 'recordRead':
      return { ...fieldVo, recordRead: newValue as boolean | undefined };
    case 'recordCreate':
      return { ...fieldVo, recordCreate: newValue as boolean | undefined };
    default:
      // For unsupported keys (like 'id' and 'type'), return the original fieldVo unchanged
      return fieldVo;
  }
}

/**
 * Apply field property operations to a field VO and return a new field VO.
 * This is a pure function that does not mutate the original field VO.
 *
 * @param fieldVo - The existing field VO to base the new field on
 * @param ops - Array of field property operations to apply
 * @returns A new field VO with the operations applied
 */
export function applyFieldPropertyOps(
  fieldVo: IFieldVo,
  ops: ISetFieldPropertyOpContext[]
): IFieldVo {
  // Always create a copy to ensure immutability, even with empty operations
  return ops.reduce(
    (currentFieldVo, op) => applyFieldPropertyOperation(currentFieldVo, op.key, op.newValue),
    { ...fieldVo }
  );
}
