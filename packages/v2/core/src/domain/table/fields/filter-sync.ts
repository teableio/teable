import type { ISpecification } from '../../shared/specification/ISpecification';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from '../specs/ITableSpecVisitor';
import { TableUpdateFieldTypeSpec } from '../specs/TableUpdateFieldTypeSpec';
import { UpdateMultipleSelectOptionsSpec } from '../specs/field-updates/UpdateMultipleSelectOptionsSpec';
import { UpdateSingleSelectOptionsSpec } from '../specs/field-updates/UpdateSingleSelectOptionsSpec';
import type { Field } from './Field';
import type { FieldId } from './FieldId';
import { FieldCondition } from './types/FieldCondition';
import type {
  RecordFilter,
  RecordFilterCondition,
  RecordFilterNode,
  RecordFilterValue,
} from '../../../queries/RecordFilterDto';

type FilterGroup = {
  conjunction: 'and' | 'or';
  filterSet: ReadonlyArray<FilterGroup | FilterItem>;
  [key: string]: unknown;
};

type FilterItem = {
  fieldId: string;
  value?: unknown;
  [key: string]: unknown;
};

type SelectOptionLike = {
  id(): { toString(): string };
  name(): { toString(): string };
  equals(other: unknown): boolean;
};

type ResultLike<T> = {
  isOk(): boolean;
  value: T;
};

type SelectOptionsFieldLike = {
  selectOptions(): ReadonlyArray<SelectOptionLike>;
};

type InnerFieldCarrierLike = {
  innerField(): ResultLike<Field>;
};

type FieldSelectOptionChangeSummary = {
  readonly renamedOptions: ReadonlyArray<{ previous: SelectOptionLike; next: SelectOptionLike }>;
  readonly removedOptions: ReadonlyArray<SelectOptionLike>;
  readonly hasAnyOptionChanges: boolean;
};

export type FieldFilterSyncPlan = {
  readonly removeReferencedFilterItems: boolean;
  readonly renamedSelectOptionValues: ReadonlyMap<string, string>;
  readonly removedSelectOptionValues: ReadonlySet<string>;
};

export const buildFieldFilterSyncPlan = (
  updatedField: Field,
  updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
): FieldFilterSyncPlan => {
  const renamedSelectOptionValues = new Map<string, string>();
  const removedSelectOptionValues = new Set<string>();
  let removeReferencedFilterItems = false;

  for (const spec of updateSpecs) {
    if (
      spec instanceof TableUpdateFieldTypeSpec &&
      spec.oldField().id().equals(updatedField.id())
    ) {
      if (spec.isTypeConversion()) {
        removeReferencedFilterItems = true;
      } else {
        const summary = getFieldSelectOptionChangeSummaryFromTypeSpec(spec);
        if (summary) {
          for (const renamed of summary.renamedOptions) {
            renamedSelectOptionValues.set(
              renamed.previous.name().toString(),
              renamed.next.name().toString()
            );
          }
          for (const removed of summary.removedOptions) {
            removedSelectOptionValues.add(removed.name().toString());
          }
        }
      }
      continue;
    }

    if (spec instanceof UpdateSingleSelectOptionsSpec && spec.fieldId().equals(updatedField.id())) {
      for (const renamed of spec.renamedOptions()) {
        renamedSelectOptionValues.set(
          renamed.previous.name().toString(),
          renamed.next.name().toString()
        );
      }
      for (const removed of spec.removedOptions()) {
        removedSelectOptionValues.add(removed.name().toString());
      }
      continue;
    }

    if (
      spec instanceof UpdateMultipleSelectOptionsSpec &&
      spec.fieldId().equals(updatedField.id())
    ) {
      for (const renamed of spec.renamedOptions()) {
        renamedSelectOptionValues.set(
          renamed.previous.name().toString(),
          renamed.next.name().toString()
        );
      }
      for (const removed of spec.removedOptions()) {
        removedSelectOptionValues.add(removed.name().toString());
      }
    }
  }

  return {
    removeReferencedFilterItems,
    renamedSelectOptionValues,
    removedSelectOptionValues,
  };
};

export const hasFieldSelectOptionChanges = (
  updatedField: Field,
  updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>
): boolean => {
  return updateSpecs.some((spec) => {
    if (
      spec instanceof UpdateSingleSelectOptionsSpec ||
      spec instanceof UpdateMultipleSelectOptionsSpec
    ) {
      if (!spec.fieldId().equals(updatedField.id())) {
        return false;
      }

      return (
        spec.addedOptions().length > 0 ||
        spec.removedOptions().length > 0 ||
        spec.modifiedOptions().length > 0
      );
    }

    if (
      spec instanceof TableUpdateFieldTypeSpec &&
      spec.oldField().id().equals(updatedField.id()) &&
      !spec.isTypeConversion()
    ) {
      return getFieldSelectOptionChangeSummaryFromTypeSpec(spec)?.hasAnyOptionChanges ?? false;
    }

    return false;
  });
};

export const hasFieldFilterSyncPlanChanges = (plan: FieldFilterSyncPlan): boolean => {
  return (
    plan.removeReferencedFilterItems ||
    plan.renamedSelectOptionValues.size > 0 ||
    plan.removedSelectOptionValues.size > 0
  );
};

export const hasSelectOptionValueChanges = (plan: FieldFilterSyncPlan): boolean => {
  return plan.renamedSelectOptionValues.size > 0 || plan.removedSelectOptionValues.size > 0;
};

export const hasFieldReferenceInFilter = (filter: unknown, fieldId: FieldId): boolean => {
  return hasFieldReferenceInFilterById(filter, fieldId.toString());
};

export const hasFieldReferenceInFilterById = (filter: unknown, fieldId: string): boolean => {
  if (isFilterItem(filter)) {
    return filter.fieldId === fieldId;
  }
  if (isFilterGroup(filter)) {
    return filter.filterSet.some((node) => hasFieldReferenceInFilterById(node, fieldId));
  }
  return false;
};

export const syncFilterByFieldChanges = (
  filter: unknown,
  fieldId: FieldId,
  plan: FieldFilterSyncPlan
): unknown | null => {
  const fieldIdValue = fieldId.toString();
  return syncFilterByFieldChangesWithId(filter, fieldIdValue, plan);
};

export const syncFilterByFieldChangesWithId = (
  filter: unknown,
  fieldId: string,
  plan: FieldFilterSyncPlan
): unknown | null => {
  if (!hasFieldFilterSyncPlanChanges(plan)) {
    return filter;
  }

  const transformNode = (node: unknown): unknown | null => {
    if (isFilterItem(node)) {
      if (node.fieldId !== fieldId) {
        return { ...node };
      }

      if (plan.removeReferencedFilterItems) {
        return null;
      }

      const valueResult = transformSelectFilterValue(
        node.value,
        plan.renamedSelectOptionValues,
        plan.removedSelectOptionValues
      );
      if (valueResult.removeItem) {
        return null;
      }

      if (!valueResult.changed) {
        return { ...node };
      }

      const nextItem: FilterItem = { ...node };
      if (valueResult.value === undefined) {
        delete nextItem.value;
      } else {
        nextItem.value = valueResult.value;
      }
      return nextItem;
    }

    if (isFilterGroup(node)) {
      const nextFilterSet = node.filterSet
        .map((entry) => transformNode(entry))
        .filter((entry): entry is FilterGroup | FilterItem => entry !== null);

      if (nextFilterSet.length === 0) {
        return null;
      }

      return {
        ...node,
        filterSet: nextFilterSet,
      };
    }

    return node;
  };

  return transformNode(filter);
};

export const isEquivalentFilter = (left: unknown, right: unknown): boolean => {
  const leftCondition = FieldCondition.create({ filter: left });
  const rightCondition = FieldCondition.create({ filter: right });
  if (leftCondition.isErr() || rightCondition.isErr()) {
    return false;
  }
  return leftCondition.value.equals(rightCondition.value);
};

export const hasFieldReferenceInRecordFilter = (filter: RecordFilter, fieldId: string): boolean => {
  if (filter == null) {
    return false;
  }
  return hasFieldReferenceInRecordFilterNode(filter, fieldId);
};

export const syncRecordFilterByFieldChanges = (
  filter: RecordFilter,
  fieldId: string,
  plan: FieldFilterSyncPlan
): RecordFilter => {
  if (filter == null || !hasFieldFilterSyncPlanChanges(plan)) {
    return filter;
  }

  const transformNode = (node: RecordFilterNode): RecordFilterNode | null => {
    if ('fieldId' in node) {
      if (node.fieldId !== fieldId) {
        return { ...node };
      }

      if (plan.removeReferencedFilterItems) {
        return null;
      }

      const valueResult = transformSelectFilterValue(
        node.value,
        plan.renamedSelectOptionValues,
        plan.removedSelectOptionValues
      );
      if (valueResult.removeItem) {
        return null;
      }

      if (!valueResult.changed) {
        return { ...node };
      }

      return {
        ...node,
        value: (valueResult.value ?? null) as RecordFilterValue,
      } as RecordFilterCondition;
    }

    if ('items' in node) {
      const nextItems = node.items
        .map((item: RecordFilterNode) => transformNode(item))
        .filter((item: RecordFilterNode | null): item is RecordFilterNode => item != null);
      if (!nextItems.length) {
        return null;
      }
      return {
        conjunction: node.conjunction,
        items: nextItems,
      };
    }

    if ('not' in node) {
      const nextNode = transformNode(node.not);
      if (nextNode == null) {
        return null;
      }
      return { not: nextNode };
    }

    return node;
  };

  return transformNode(filter) ?? null;
};

export const isEquivalentRecordFilter = (left: RecordFilter, right: RecordFilter): boolean => {
  return JSON.stringify(left) === JSON.stringify(right);
};

const transformSelectFilterValue = (
  value: unknown,
  renameMap: ReadonlyMap<string, string>,
  removeSet: ReadonlySet<string>
): { value?: unknown; removeItem: boolean; changed: boolean } => {
  if (Array.isArray(value)) {
    const nextValues = value
      .filter((entry) => !(typeof entry === 'string' && removeSet.has(entry)))
      .map((entry) => (typeof entry === 'string' ? renameMap.get(entry) ?? entry : entry));

    if (nextValues.length === 0) {
      return { removeItem: true, changed: true };
    }

    if (nextValues.length === value.length && nextValues.every((entry, i) => entry === value[i])) {
      return { value, removeItem: false, changed: false };
    }

    return { value: nextValues, removeItem: false, changed: true };
  }

  if (typeof value === 'string') {
    if (removeSet.has(value)) {
      return { removeItem: true, changed: true };
    }
    const renamed = renameMap.get(value);
    if (renamed === undefined || renamed === value) {
      return { value, removeItem: false, changed: false };
    }
    return { value: renamed, removeItem: false, changed: true };
  }

  return { value, removeItem: false, changed: false };
};

const isFilterGroup = (value: unknown): value is FilterGroup => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record.conjunction === 'and' || record.conjunction === 'or') && Array.isArray(record.filterSet)
  );
};

const isFilterItem = (value: unknown): value is FilterItem => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.fieldId === 'string';
};

const getFieldSelectOptionChangeSummaryFromTypeSpec = (
  spec: TableUpdateFieldTypeSpec
): FieldSelectOptionChangeSummary | undefined => {
  return getFieldSelectOptionChangeSummary(spec.oldField(), spec.newField());
};

const getFieldSelectOptionChangeSummary = (
  previousField: Field,
  nextField: Field
): FieldSelectOptionChangeSummary | undefined => {
  const previousOptions = extractFieldSelectOptions(previousField);
  const nextOptions = extractFieldSelectOptions(nextField);
  if (!previousOptions || !nextOptions) {
    return undefined;
  }

  const previousById = new Map(previousOptions.map((option) => [option.id().toString(), option]));
  const nextById = new Map(nextOptions.map((option) => [option.id().toString(), option]));

  const renamedOptions = nextOptions.flatMap((nextOption) => {
    const previousOption = previousById.get(nextOption.id().toString());
    if (!previousOption || previousOption.name().toString() === nextOption.name().toString()) {
      return [];
    }
    return [{ previous: previousOption, next: nextOption }];
  });

  const removedOptions = previousOptions.filter((option) => !nextById.has(option.id().toString()));
  const hasAddedOptions = nextOptions.some((option) => !previousById.has(option.id().toString()));
  const hasModifiedOptions = nextOptions.some((nextOption) => {
    const previousOption = previousById.get(nextOption.id().toString());
    return previousOption ? !previousOption.equals(nextOption) : false;
  });
  const hasOrderChanges =
    previousOptions.length === nextOptions.length &&
    previousOptions.some(
      (previousOption, index) =>
        nextOptions[index]?.id().toString() !== previousOption.id().toString()
    );

  return {
    renamedOptions,
    removedOptions,
    hasAnyOptionChanges:
      hasAddedOptions || removedOptions.length > 0 || hasModifiedOptions || hasOrderChanges,
  };
};

const extractFieldSelectOptions = (field: Field): ReadonlyArray<SelectOptionLike> | undefined => {
  const fieldType = field.type().toString();
  if ((fieldType === 'singleSelect' || fieldType === 'multipleSelect') && hasSelectOptions(field)) {
    return field.selectOptions();
  }

  if ((fieldType === 'lookup' || fieldType === 'conditionalLookup') && hasInnerField(field)) {
    const innerFieldResult = field.innerField();
    if (innerFieldResult.isOk()) {
      return extractFieldSelectOptions(innerFieldResult.value);
    }
  }

  return undefined;
};

const hasFieldReferenceInRecordFilterNode = (node: RecordFilterNode, fieldId: string): boolean => {
  if ('fieldId' in node) {
    return node.fieldId === fieldId;
  }
  if ('items' in node) {
    return node.items.some((item: RecordFilterNode) =>
      hasFieldReferenceInRecordFilterNode(item, fieldId)
    );
  }
  if ('not' in node) {
    return hasFieldReferenceInRecordFilterNode(node.not, fieldId);
  }
  return false;
};

const hasSelectOptions = (field: Field): field is Field & SelectOptionsFieldLike => {
  return (
    'selectOptions' in field &&
    typeof (field as SelectOptionsFieldLike).selectOptions === 'function'
  );
};

const hasInnerField = (field: Field): field is Field & InnerFieldCarrierLike => {
  return 'innerField' in field && typeof (field as InnerFieldCarrierLike).innerField === 'function';
};
