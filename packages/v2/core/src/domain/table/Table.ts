import type { ITableActionKey } from '@teable/core';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import { type ITableMapper } from '../../ports/mappers/TableMapper';
import type { RecordFilter } from '../../queries/RecordFilterDto';
import type { BaseId } from '../base/BaseId';
import { AggregateRoot } from '../shared/AggregateRoot';
import type { IDomainContext } from '../shared/DomainContext';
import { domainError, type DomainError } from '../shared/DomainError';
import { topologicalSort } from '../shared/graph/topologicalSort';
import type { ISpecification } from '../shared/specification/ISpecification';
import type { ISpecVisitor } from '../shared/specification/ISpecVisitor';
import { NotSpec } from '../shared/specification/NotSpec';

import { DbTableName } from './DbTableName';
import type { RecordCreateSource } from './events/RecordFieldValuesDTO';
import { TableActionTriggerRequested } from './events/TableActionTriggerRequested';
import { TableCreated } from './events/TableCreated';
import { TableDeleted } from './events/TableDeleted';
import { TableRestored } from './events/TableRestored';
import { TableTrashed } from './events/TableTrashed';
import type { DbFieldName } from './fields/DbFieldName';
import { DbFieldType } from './fields/DbFieldType';
import type { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import { FieldName } from './fields/FieldName';
import { FieldType } from './fields/FieldType';
import { validateForeignTablesForFields } from './fields/ForeignTableRelatedField';
import { FieldIsComputedSpec } from './fields/specs/FieldIsComputedSpec';
import { CellValueMultiplicity } from './fields/types/CellValueMultiplicity';
import { CellValueType } from './fields/types/CellValueType';
import type { FieldHasError } from './fields/types/FieldHasError';
import type { FieldNotNull } from './fields/types/FieldNotNull';
import type { FieldUnique } from './fields/types/FieldUnique';
import { LookupField } from './fields/types/LookupField';
import { MultipleSelectField } from './fields/types/MultipleSelectField';
import {
  ensureSelectFieldOptionCountWithinLimit,
  ensureSelectFieldOptionNamesWithinLimit,
} from './fields/types/SelectFieldOptionWriteConfig';
import type { SelectOption } from './fields/types/SelectOption';
import { SingleSelectField } from './fields/types/SingleSelectField';
import { FieldCellValueSchemaVisitor } from './fields/visitors/FieldCellValueSchemaVisitor';
import { FieldDefaultValueVisitor } from './fields/visitors/FieldDefaultValueVisitor';
import { FieldValueTypeVisitor } from './fields/visitors/FieldValueTypeVisitor';
import {
  LinkForeignTableReferenceVisitor,
  type LinkForeignTableReference,
} from './fields/visitors/LinkForeignTableReferenceVisitor';
import {
  applyViewManualSort as applyViewManualSortMethod,
  type ApplyViewManualSortMethodResult,
} from './methods/applyViewManualSort';
import {
  applyViewSnapshot as applyViewSnapshotMethod,
  type ApplyViewSnapshotMethodResult,
} from './methods/applyViewSnapshot';
import {
  createButtonClickPlan as createButtonClickPlanMethod,
  type ButtonClickPlan,
  type CreateButtonClickPlanParams,
} from './methods/createButtonClickPlan';
import {
  createCollapsedGroupExclusionFilter as createCollapsedGroupExclusionFilterMethod,
  type CollapsedGroupValueRow,
} from './methods/createCollapsedGroupExclusionFilter';
import {
  createRecordAggregation as createRecordAggregationMethod,
  type CreateRecordAggregationParams,
} from './methods/createRecordAggregation';
import {
  createRecordCalendarDailyCollection as createRecordCalendarDailyCollectionMethod,
  type CreateRecordCalendarDailyCollectionParams,
} from './methods/createRecordCalendarDailyCollection';
import {
  createView as createViewMethod,
  type CreateViewMethodParams,
  type CreateViewMethodResult,
} from './methods/createView';
import {
  createRecordCollaboratorsQueryPlan as createRecordCollaboratorsQueryPlanMethod,
  createViewCollaboratorsQueryPlan as createViewCollaboratorsQueryPlanMethod,
  type CreateViewCollaboratorsQueryPlanParams,
  type ViewCollaboratorsQueryPlan,
} from './methods/createViewCollaboratorsQueryPlan';
import {
  createViewLinkRecordsQueryPlan as createViewLinkRecordsQueryPlanMethod,
  type CreateViewLinkRecordsQueryPlanParams,
  type ViewLinkRecordsQueryPlan,
} from './methods/createViewLinkRecordsQueryPlan';
import {
  createViewSelectionCopyPlan as createViewSelectionCopyPlanMethod,
  type CreateViewSelectionCopyPlanParams,
  type ViewSelectionCopyPlan,
} from './methods/createViewSelectionCopyPlan';
import {
  clearViewFilterDependencies as clearViewFilterDependenciesMethod,
  deleteView as deleteViewMethod,
  type DeleteViewMethodResult,
} from './methods/deleteView';
import {
  duplicate as duplicateMethod,
  type DuplicateMethodParams as TableDuplicateParams,
  type DuplicateMethodResult as TableDuplicateResult,
} from './methods/duplicate';
import {
  duplicateView as duplicateViewMethod,
  type DuplicateViewMethodOptions,
  type DuplicateViewMethodResult,
} from './methods/duplicateView';
import {
  getOrderedVisibleFieldIds as getOrderedVisibleFieldIdsMethod,
  type GetOrderedVisibleFieldIdsOptions,
} from './methods/getOrderedVisibleFieldIds';
import {
  createRecord as createRecordMethod,
  createRecords as createRecordsMethod,
  createRecordsStream as createRecordsStreamMethod,
  createRecordsStreamAsync as createRecordsStreamAsyncMethod,
  updateRecord as updateRecordMethod,
  updateRecordsStream as updateRecordsStreamMethod,
  type CreateRecordsMethodResult,
  type CreateRecordsStreamOptions,
  type UpdateRecordItem,
  type UpdateRecordOptions,
  type UpdateRecordsStreamOptions,
} from './methods/records';
import {
  refreshViewShareId as refreshViewShareIdMethod,
  type RefreshViewShareIdMethodResult,
} from './methods/refreshViewShareId';
import { rename as renameMethod } from './methods/rename';
import { renameView as renameViewMethod, type RenameViewMethodResult } from './methods/renameView';
import {
  resetButtonValue as resetButtonValueMethod,
  type ResetButtonValueParams,
} from './methods/resetButtonValue';
import {
  setButtonValue as setButtonValueMethod,
  type SetButtonValueParams,
} from './methods/setButtonValue';
import { updateProperties as updatePropertiesMethod } from './methods/updateProperties';
import {
  updateViewColumnMeta as updateViewColumnMetaMethod,
  type UpdateViewColumnMetaMethodResult,
} from './methods/updateViewColumnMeta';
import {
  updateViewDescription as updateViewDescriptionMethod,
  type UpdateViewDescriptionMethodResult,
} from './methods/updateViewDescription';
import {
  updateViewFilter as updateViewFilterMethod,
  type UpdateViewFilterMethodResult,
} from './methods/updateViewFilter';
import {
  updateViewGroup as updateViewGroupMethod,
  type UpdateViewGroupMethodResult,
} from './methods/updateViewGroup';
import {
  updateViewLocked as updateViewLockedMethod,
  type UpdateViewLockedMethodResult,
} from './methods/updateViewLocked';
import {
  updateViewOptions as updateViewOptionsMethod,
  type UpdateViewOptionsMethodResult,
} from './methods/updateViewOptions';
import {
  updateViewOrder as updateViewOrderMethod,
  type UpdateViewOrderMethodResult,
  type ViewOrderPosition,
} from './methods/updateViewOrder';
import {
  updateViewShareMeta as updateViewShareMetaMethod,
  type UpdateViewShareMetaMethodResult,
} from './methods/updateViewShareMeta';
import {
  disableViewShare as disableViewShareMethod,
  enableViewShare as enableViewShareMethod,
  type TableDisableViewShareResult,
  type TableEnableViewShareResult,
} from './methods/updateViewShareState';
import {
  updateViewSort as updateViewSortMethod,
  type UpdateViewSortMethodResult,
} from './methods/updateViewSort';
import { validateFormSubmission as validateFormSubmissionMethod } from './methods/validateFormSubmission';
import {
  fieldFilterLinkScope as fieldFilterLinkScopeMethod,
  type FieldFilterLinkScope,
} from './methods/fieldFilterLinkScope';
import {
  viewFilterLinkReferences as viewFilterLinkReferencesMethod,
  type ViewFilterLinkReference,
} from './methods/viewFilterLinkReferences';
import type { RecordCreateResult } from './records/RecordCreateResult';
import type { RecordId } from './records/RecordId';
import type { RecordUpdateResult } from './records/RecordUpdateResult';
import type { TableRecord } from './records/TableRecord';
import type { TableRecordAggregation } from './records/TableRecordAggregation';
import type { TableRecordCalendarDailyCollection } from './records/TableRecordCalendarDailyCollection';
import { resolveFormulaFields } from './resolveFormulaFields';
import type { ITableSpecVisitor } from './specs/ITableSpecVisitor';
import { TableSpecBuilder } from './specs/TableSpecBuilder';
import type { ITableBuildProps } from './TableBuilder';
import { TableBuilder } from './TableBuilder';
import type { TableId } from './TableId';
import { TableMutator, type TableUpdateResult } from './TableMutator';
import type { TableName } from './TableName';
import { TableProperties, type TablePropertiesPatch } from './TableProperties';
import type { View } from './views/View';
import {
  ViewColumnMeta,
  type ViewColumnMetaEntry,
  type ViewColumnMetaPatch,
} from './views/ViewColumnMeta';
import type { ViewId } from './views/ViewId';
import type { ViewName } from './views/ViewName';
import type { ViewQueryGroupItem } from './views/ViewQueryDefaults';
import { CloneViewVisitor } from './views/visitors/CloneViewVisitor';

export type TableCreateViewInput = CreateViewMethodParams;
export type TableCreateViewResult = CreateViewMethodResult;
export type TableDeleteViewResult = DeleteViewMethodResult;
export type TableDuplicateViewOptions = DuplicateViewMethodOptions;
export type TableDuplicateViewResult = DuplicateViewMethodResult;
export type TableRenameViewResult = RenameViewMethodResult;
export type TableUpdateViewDescriptionResult = UpdateViewDescriptionMethodResult;
export type TableUpdateViewLockedResult = UpdateViewLockedMethodResult;
export type TableUpdateViewOrderResult = UpdateViewOrderMethodResult;
export type TableUpdateViewOptionsResult = UpdateViewOptionsMethodResult;
export type TableUpdateViewColumnMetaResult = UpdateViewColumnMetaMethodResult;
export type TableUpdateViewFilterResult = UpdateViewFilterMethodResult;
export type TableUpdateViewGroupResult = UpdateViewGroupMethodResult;
export type TableUpdateViewSortResult = UpdateViewSortMethodResult;
export type TableRefreshViewShareIdResult = RefreshViewShareIdMethodResult;
export type TableApplyViewManualSortResult = ApplyViewManualSortMethodResult;
export type TableApplyViewSnapshotResult = ApplyViewSnapshotMethodResult;
export type TableViewFilterLinkReference = ViewFilterLinkReference;
export type TableButtonClickPlan = ButtonClickPlan;

const isPersistedScalarDbFieldType = (value: string): boolean => {
  switch (value.trim().toUpperCase()) {
    case 'REAL':
    case 'DATETIME':
    case 'BOOLEAN':
    case 'INTEGER':
    case 'BIGINT':
    case 'SMALLINT':
      return true;
    default:
      return false;
  }
};

const dbFieldTypeFromFieldType = (fieldType: FieldType): string | undefined => {
  if (fieldType.equals(FieldType.autoNumber())) return 'INTEGER';
  if (fieldType.equals(FieldType.number()) || fieldType.equals(FieldType.rating())) return 'REAL';
  if (
    fieldType.equals(FieldType.link()) ||
    fieldType.equals(FieldType.user()) ||
    fieldType.equals(FieldType.createdBy()) ||
    fieldType.equals(FieldType.lastModifiedBy()) ||
    fieldType.equals(FieldType.attachment()) ||
    fieldType.equals(FieldType.button())
  ) {
    return 'JSON';
  }
  if (
    fieldType.equals(FieldType.date()) ||
    fieldType.equals(FieldType.createdTime()) ||
    fieldType.equals(FieldType.lastModifiedTime())
  ) {
    return 'DATETIME';
  }
  if (fieldType.equals(FieldType.checkbox())) return 'BOOLEAN';
  return undefined;
};

const deriveDbFieldTypeFromResolvedField = (field: Field): string | undefined => {
  if (field instanceof LookupField && field.isPending()) return undefined;
  if (field instanceof LookupField) {
    const innerType = field.innerFieldType();
    if (innerType.isOk()) {
      const fromInner = dbFieldTypeFromFieldType(innerType.value);
      if (fromInner) return fromInner;
    }
  }
  const fromOwnType = dbFieldTypeFromFieldType(field.type());
  if (fromOwnType) return fromOwnType;
  const valueType = field.accept(new FieldValueTypeVisitor());
  if (valueType.isErr()) return undefined;
  switch (valueType.value.cellValueType.toString()) {
    case 'number':
      return 'REAL';
    case 'dateTime':
      return 'DATETIME';
    case 'boolean':
      return 'BOOLEAN';
    default:
      return undefined;
  }
};

export class Table extends AggregateRoot<TableId> {
  private dbTableNameValue: DbTableName;

  private constructor(
    id: TableId,
    private readonly baseIdValue: BaseId,
    private readonly nameValue: TableName,
    private readonly propertiesValue: TableProperties,
    private readonly fieldsValue: ReadonlyArray<Field>,
    private readonly viewsValue: ReadonlyArray<View>,
    private readonly primaryFieldIdValue: FieldId,
    options: { emitCreatedEvent: boolean }
  ) {
    super(id);

    if (options.emitCreatedEvent) {
      this.addDomainEvent(
        TableCreated.create({
          tableId: id,
          baseId: this.baseIdValue,
          tableName: nameValue,
          fieldIds: fieldsValue.map((f) => f.id()),
          viewIds: viewsValue.map((v) => v.id()),
        })
      );
    }
    this.dbTableNameValue = DbTableName.empty();
  }

  static builder(): TableBuilder {
    const factory = (props: ITableBuildProps): Table =>
      new Table(
        props.id,
        props.baseId,
        props.name,
        props.properties ?? TableProperties.empty(),
        props.fields,
        props.views,
        props.primaryFieldId,
        {
          emitCreatedEvent: true,
        }
      );
    return TableBuilder.create(factory);
  }

  static specs(baseId?: BaseId): TableSpecBuilder {
    return TableSpecBuilder.create(baseId);
  }

  specs(): TableSpecBuilder {
    return TableSpecBuilder.create(this.baseIdValue);
  }

  static rehydrate(props: ITableBuildProps): Result<Table, DomainError> {
    if (props.fields.length === 0)
      return err(domainError.unexpected({ message: 'Table requires at least one Field' }));
    if (!props.fields.some((f) => f.id().equals(props.primaryFieldId)))
      return err(domainError.validation({ message: 'Primary Field must exist in Table fields' }));

    const table = new Table(
      props.id,
      props.baseId,
      props.name,
      props.properties ?? TableProperties.empty(),
      props.fields,
      props.views,
      props.primaryFieldId,
      {
        emitCreatedEvent: false,
      }
    );

    if (props.dbTableName) {
      const setResult = table.setDbTableName(props.dbTableName);
      if (setResult.isErr()) return err(setResult.error);
    }

    return ok(table);
  }

  baseId(): BaseId {
    return this.baseIdValue;
  }

  name(): TableName {
    return this.nameValue;
  }

  properties(): TableProperties {
    return this.propertiesValue;
  }

  description(): string | undefined {
    return this.propertiesValue.description();
  }

  icon(): string | undefined {
    return this.propertiesValue.icon();
  }

  dbTableName(): Result<DbTableName, DomainError> {
    const valueResult = this.dbTableNameValue.value();
    if (valueResult.isErr()) return err(valueResult.error);
    return ok(this.dbTableNameValue);
  }

  clone(mapper: ITableMapper): Result<Table, DomainError> {
    return mapper.toDTO(this).andThen((dto) => mapper.toDomain(dto));
  }

  duplicate(params: TableDuplicateParams): Result<TableDuplicateResult, DomainError> {
    return duplicateMethod.call(this, params);
  }

  setDbTableName(dbTableName: DbTableName): Result<void, DomainError> {
    const nextValue = dbTableName.value();
    if (nextValue.isErr()) return err(nextValue.error);

    // Probe with isRehydrated() instead of value(): the unset branch is the
    // common case on rehydration, and value() would allocate a stack-capturing
    // DomainError per call just to signal "not set".
    if (this.dbTableNameValue.isRehydrated()) {
      if (!this.dbTableNameValue.equals(dbTableName))
        return err(domainError.invariant({ message: 'DbTableName already set' }));
      return ok(undefined);
    }

    this.dbTableNameValue = dbTableName;
    return ok(undefined);
  }

  getField<T extends Field>(predicate: (field: Field) => field is T): Result<T, DomainError>;
  getField(predicate: (field: Field) => boolean): Result<Field, DomainError>;
  getField(spec: ISpecification<Field, ISpecVisitor>): Result<Field, DomainError>;
  getField<T extends Field>(
    predicateOrSpec:
      | ((field: Field) => field is T)
      | ((field: Field) => boolean)
      | ISpecification<Field, ISpecVisitor>
  ): Result<T | Field, DomainError> {
    const predicate =
      typeof predicateOrSpec === 'function'
        ? predicateOrSpec
        : (field: Field) => predicateOrSpec.isSatisfiedBy(field);
    const field = this.fieldsValue.find(predicate);
    if (!field) return err(domainError.notFound({ message: 'Field not found' }));
    return ok(field);
  }

  getFields<T extends Field>(predicate: (field: Field) => field is T): ReadonlyArray<T>;
  getFields(predicate: (field: Field) => boolean): ReadonlyArray<Field>;
  getFields(spec: ISpecification<Field, ISpecVisitor>): ReadonlyArray<Field>;
  getFields(): ReadonlyArray<Field>;
  getFields<T extends Field>(
    predicateOrSpec?:
      | ((field: Field) => field is T)
      | ((field: Field) => boolean)
      | ISpecification<Field, ISpecVisitor>
  ): ReadonlyArray<T | Field> {
    if (!predicateOrSpec) return [...this.fieldsValue];
    const predicate =
      typeof predicateOrSpec === 'function'
        ? predicateOrSpec
        : (field: Field) => predicateOrSpec.isSatisfiedBy(field);
    return this.fieldsValue.filter(predicate);
  }

  generateFieldName(baseName: FieldName): Result<FieldName, DomainError> {
    const existingNames = this.fieldsValue.map((field) => field.name());
    if (!existingNames.some((name) => name.equals(baseName))) {
      return ok(baseName);
    }

    const baseValue = baseName.toString();
    for (let index = 1; index <= 100; index += 1) {
      const suffix = index === 1 ? ' (linked)' : ` (linked ${index})`;
      const candidateResult = FieldName.create(`${baseValue}${suffix}`);
      if (candidateResult.isErr()) return err(candidateResult.error);
      const candidate = candidateResult.value;
      if (!existingNames.some((name) => name.equals(candidate))) {
        return ok(candidate);
      }
    }

    return err(domainError.conflict({ message: 'Failed to generate unique FieldName' }));
  }

  primaryFieldId(): FieldId {
    return this.primaryFieldIdValue;
  }

  primaryField(): Result<Field, DomainError> {
    const field = this.fieldsValue.find((f) => f.id().equals(this.primaryFieldIdValue));
    if (!field) return err(domainError.notFound({ message: 'Primary field not found' }));
    return ok(field);
  }

  views(): ReadonlyArray<View> {
    return [...this.viewsValue];
  }

  defaultView(): Result<View, DomainError> {
    const view = this.viewsValue[0];
    if (!view) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found with tableId: ${this.id().toString()}`,
        })
      );
    }
    return ok(view);
  }

  /**
   * Get a view by its ID.
   * @param viewId - The view ID to find
   * @returns Result containing the view or a not found error
   */
  getView(viewId: ViewId): Result<View, DomainError> {
    const view = this.viewsValue.find((v) => v.id().equals(viewId));
    if (!view) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${viewId.toString()}`,
        })
      );
    }
    return ok(view);
  }

  /**
   * Get a view by its ID string.
   * @param viewIdStr - The view ID string to find
   * @returns Result containing the view or a not found error
   */
  getViewById(viewIdStr: string): Result<View, DomainError> {
    const view = this.viewsValue.find((v) => v.id().toString() === viewIdStr);
    if (!view) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${viewIdStr}`,
        })
      );
    }
    return ok(view);
  }

  viewFilterLinkReferences(
    viewId: ViewId
  ): Result<ReadonlyArray<TableViewFilterLinkReference>, DomainError> {
    return viewFilterLinkReferencesMethod.call(this, viewId);
  }

  fieldFilterLinkScope(fieldId: FieldId): Result<FieldFilterLinkScope | null, DomainError> {
    return fieldFilterLinkScopeMethod.call(this, fieldId);
  }

  /**
   * Get ordered visible field IDs for a view.
   *
   * - If projection is provided, uses the projection's field order
   * - Otherwise filters hidden fields based on view type and sorts by columnMeta order
   *
   * @param viewId - The view ID
   * @param options - Optional projection for custom field order
   * @returns Ordered visible field IDs
   */
  getOrderedVisibleFieldIds(
    viewId: string,
    options?: GetOrderedVisibleFieldIdsOptions
  ): Result<ReadonlyArray<FieldId>, DomainError> {
    return getOrderedVisibleFieldIdsMethod.call(this, viewId, options);
  }

  createRecordAggregation(
    params: CreateRecordAggregationParams
  ): Result<TableRecordAggregation, DomainError> {
    return createRecordAggregationMethod.call(this, params);
  }

  createRecordCalendarDailyCollection(
    params: CreateRecordCalendarDailyCollectionParams
  ): Result<TableRecordCalendarDailyCollection, DomainError> {
    return createRecordCalendarDailyCollectionMethod.call(this, params);
  }

  createViewLinkRecordsQueryPlan(
    params: CreateViewLinkRecordsQueryPlanParams
  ): Result<ViewLinkRecordsQueryPlan, DomainError> {
    return createViewLinkRecordsQueryPlanMethod.call(this, params);
  }

  createViewCollaboratorsQueryPlan(
    params: CreateViewCollaboratorsQueryPlanParams
  ): Result<ViewCollaboratorsQueryPlan, DomainError> {
    return createViewCollaboratorsQueryPlanMethod.call(this, params);
  }

  createRecordCollaboratorsQueryPlan(
    fieldId: FieldId
  ): Result<ViewCollaboratorsQueryPlan, DomainError> {
    return createRecordCollaboratorsQueryPlanMethod.call(this, fieldId);
  }

  createViewSelectionCopyPlan(
    params: CreateViewSelectionCopyPlanParams
  ): Result<ViewSelectionCopyPlan, DomainError> {
    return createViewSelectionCopyPlanMethod.call(this, params);
  }

  createCollapsedGroupExclusionFilter(
    groupBy: ReadonlyArray<ViewQueryGroupItem>,
    groupedRows: ReadonlyArray<CollapsedGroupValueRow>,
    collapsedGroupIds: ReadonlySet<string>
  ): Result<RecordFilter | undefined, DomainError> {
    return createCollapsedGroupExclusionFilterMethod.call(
      this,
      groupBy,
      groupedRows,
      collapsedGroupIds
    );
  }

  validateFormSubmission(
    formId: string,
    fieldValues: ReadonlyMap<string, unknown>
  ): Result<void, DomainError> {
    return validateFormSubmissionMethod.call(this, formId, fieldValues);
  }

  fieldsByDependencies(): {
    ordered: ReadonlyArray<Field>;
    cycles: ReadonlyArray<ReadonlyArray<FieldId>>;
  } {
    const nodes = this.fieldsValue.map((field) => ({
      id: field.id(),
      dependencies: field.dependencies(),
    }));
    const result = topologicalSort(nodes);
    const fieldById = new Map(
      this.fieldsValue.map((field) => [field.id().toString(), field] as const)
    );
    return {
      ordered: result.order.map((id) => fieldById.get(id.toString())!),
      cycles: result.cycles,
    };
  }

  fieldIds(): ReadonlyArray<FieldId> {
    return this.fieldsValue.map((f) => f.id());
  }

  foreignTableReferences(): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const visitor = new LinkForeignTableReferenceVisitor();
    return this.fieldsValue
      .reduce<Result<ReadonlyArray<LinkForeignTableReference>, DomainError>>(
        (acc, field) =>
          acc.andThen((refs) => field.accept(visitor).map((next) => [...refs, ...next])),
        ok([])
      )
      .map((refs) => {
        const seen = new Set<string>();
        const unique: LinkForeignTableReference[] = [];
        for (const ref of refs) {
          const baseKey = ref.baseId ? ref.baseId.toString() : 'local';
          const key = `${baseKey}:${ref.foreignTableId.toString()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(ref);
        }
        return unique;
      });
  }

  /**
   * Get editable (non-computed) fields in this table.
   * Uses NotSpec(FieldIsComputedSpec) internally.
   */
  getEditableFields(): ReadonlyArray<Field> {
    const notComputedSpec = new NotSpec(FieldIsComputedSpec.create());
    return this.getFields(notComputedSpec);
  }

  getRequiredFieldsWithoutDefaults(
    excludeFieldIds: ReadonlyArray<FieldId> = []
  ): Result<ReadonlyArray<Field>, DomainError> {
    const excludedFieldIds = new Set(excludeFieldIds.map((fieldId) => fieldId.toString()));
    const defaultValueVisitor = FieldDefaultValueVisitor.create();
    const blockingFields: Field[] = [];

    for (const field of this.getEditableFields()) {
      if (excludedFieldIds.has(field.id().toString()) || !field.notNull().toBoolean()) {
        continue;
      }

      const defaultValueResult = field.accept(defaultValueVisitor);
      if (defaultValueResult.isErr()) {
        return err(defaultValueResult.error);
      }

      if (defaultValueResult.value === undefined) {
        blockingFields.push(field);
      }
    }

    return ok(blockingFields);
  }

  validateCreateWithPrimaryOnly(): Result<void, DomainError> {
    return this.primaryField().andThen((primaryField) => {
      if (primaryField.computed().toBoolean()) {
        return err(
          domainError.validation({
            code: 'paste.link_auto_create_computed_primary_unsupported',
            message:
              'Auto-creating linked rows from paste is not supported when the foreign primary field is computed.',
            details: {
              tableId: this.id().toString(),
              primaryFieldId: primaryField.id().toString(),
            },
          })
        );
      }

      const primaryFieldValueTypeResult = primaryField.accept(new FieldValueTypeVisitor());
      if (primaryFieldValueTypeResult.isErr()) {
        return err(primaryFieldValueTypeResult.error);
      }

      if (
        !primaryFieldValueTypeResult.value.cellValueType.equals(CellValueType.string()) ||
        !primaryFieldValueTypeResult.value.isMultipleCellValue.equals(
          CellValueMultiplicity.single()
        )
      ) {
        return err(
          domainError.validation({
            code: 'paste.link_auto_create_requires_text_primary',
            message:
              'Auto-creating linked rows from paste is only supported when the foreign primary field resolves to a single string value.',
            details: {
              tableId: this.id().toString(),
              primaryFieldId: primaryField.id().toString(),
              primaryFieldType: primaryField.type().toString(),
              cellValueType: primaryFieldValueTypeResult.value.cellValueType.toString(),
              isMultipleCellValue:
                primaryFieldValueTypeResult.value.isMultipleCellValue.toBoolean(),
            },
          })
        );
      }

      return this.getRequiredFieldsWithoutDefaults([primaryField.id()]).andThen(
        (blockingRequiredFields) => {
          if (blockingRequiredFields.length === 0) {
            return ok(undefined);
          }

          return err(
            domainError.validation({
              code: 'paste.link_auto_create_missing_required_fields',
              message:
                'Auto-creating linked rows from paste is not supported when the foreign table has required fields without defaults.',
              details: {
                tableId: this.id().toString(),
                primaryFieldId: primaryField.id().toString(),
                requiredFieldIds: blockingRequiredFields.map((field) => field.id().toString()),
                requiredFieldNames: blockingRequiredFields.map((field) => field.name().toString()),
              },
            })
          );
        }
      );
    });
  }

  /**
   * Create a Zod schema for record input validation.
   * Only includes editable (non-computed) fields.
   *
   * @returns Result containing the Zod object schema
   *
   * @example
   * ```typescript
   * const schemaResult = table.createRecordInputSchema();
   * if (schemaResult.isOk()) {
   *   const validated = schemaResult.value.safeParse({ fieldId: 'value' });
   * }
   * ```
   */
  createRecordInputSchema(): Result<z.ZodObject<Record<string, z.ZodTypeAny>>, DomainError> {
    const editableFields = this.getEditableFields();
    const schemaShape: Record<string, z.ZodTypeAny> = {};
    const visitor = FieldCellValueSchemaVisitor.create();

    for (const field of editableFields) {
      const schemaResult = field.accept(visitor);
      if (schemaResult.isErr()) {
        return err(schemaResult.error);
      }
      schemaShape[field.id().toString()] = schemaResult.value;
    }

    return ok(z.object(schemaShape));
  }

  /**
   * Create a new record for this table with the given field values.
   *
   * This method:
   * 1. Generates a new record ID
   * 2. Validates and applies field values using the mutation spec builder
   * 3. Returns the fully constructed record
   *
   * @param fieldValues - Map of field IDs to raw values
   * @param options - Optional configuration
   * @param options.typecast - If true, values are converted to the expected type (e.g., "123" → 123)
   * @returns Result containing the RecordCreateResult (record + mutateSpec) or validation error
   *
   * @example
   * ```typescript
   * const recordResult = table.createRecord(new Map([
   *   ['fld123', 'John Doe'],
   *   ['fld456', 30],
   * ]));
   * ```
   */
  createRecord(
    fieldValues: ReadonlyMap<string, unknown>,
    options?: { typecast?: boolean; source?: RecordCreateSource }
  ): Result<RecordCreateResult, DomainError> {
    return createRecordMethod.call(this, fieldValues, options);
  }

  createButtonClickPlan(params: CreateButtonClickPlanParams): Result<ButtonClickPlan, DomainError> {
    return createButtonClickPlanMethod.call(this, params);
  }

  setButtonValue(params: SetButtonValueParams): Result<RecordUpdateResult, DomainError> {
    return setButtonValueMethod.call(this, params);
  }

  resetButtonValue(params: ResetButtonValueParams): Result<RecordUpdateResult, DomainError> {
    return resetButtonValueMethod.call(this, params);
  }

  /**
   * Update a record with the given field values.
   *
   * This method:
   * 1. Validates provided field values (no defaults are applied)
   * 2. Builds a mutation spec for the provided fields
   * 3. Returns both the mutated record and the mutation spec
   *
   * The mutation spec can be used by repository adapters to generate
   * optimized SQL statements (e.g., atomic increments, batch updates).
   *
   * @param recordId - The record to update
   * @param fieldValues - Map of field IDs to raw values
   * @param options - Optional configuration
   * @param options.typecast - If true, values are converted to the expected type (e.g., "123" → 123)
   * @returns Result containing the RecordUpdateResult (record + mutateSpec) or validation error
   */
  updateRecord(
    recordId: RecordId,
    fieldValues: ReadonlyMap<string, unknown>,
    options?: UpdateRecordOptions
  ): Result<RecordUpdateResult, DomainError> {
    return updateRecordMethod.call(this, recordId, fieldValues, options);
  }

  /**
   * Update records in a streaming/batched fashion using a Generator.
   *
   * This method is memory-friendly for bulk updates:
   * - Lazily processes input update items
   * - Yields batches of RecordUpdateResults (containing record + mutateSpec)
   * - Only keeps batchSize records in memory at a time
   * - Stops immediately on first validation error
   *
   * @param updates - Iterable of { recordId, fieldValues } items
   * @param options - Optional configuration
   * @param options.typecast - If true, values are converted to the expected type
   * @param options.batchSize - Number of records per batch (default: 500)
   * @param options.maxBatchSize - Dynamic batch-size cap when batchSize is not specified
   * @returns Generator yielding Result batches of RecordUpdateResult
   *
   * @example
   * ```typescript
   * // Process bulk updates with bounded memory
   * function* generateUpdates() {
   *   for (const { recordId, values } of updateItems) {
   *     yield { recordId, fieldValues: new Map(Object.entries(values)) };
   *   }
   * }
   *
   * for (const batchResult of table.updateRecordsStream(generateUpdates(), { batchSize: 500 })) {
   *   if (batchResult.isErr()) {
   *     console.error(batchResult.error);
   *     break;
   *   }
   *   // Process batch using repository.updateManyStream
   * }
   * ```
   */
  *updateRecordsStream(
    updates: Iterable<UpdateRecordItem>,
    options?: UpdateRecordsStreamOptions
  ): Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
    yield* updateRecordsStreamMethod.call(this, updates, options);
  }

  /**
   * Create multiple records for this table with the given field values.
   *
   * This method:
   * 1. Iterates through all field values arrays
   * 2. Creates each record using the same logic as createRecord
   * 3. Returns all created records or the first validation error
   *
   * @param recordsFieldValues - Array of record seeds (field values and optional IDs)
   * @returns Result containing records and fieldKeyMapping, or validation error
   *
   * @example
   * ```typescript
   * // Keys can be fieldId or fieldName
   * const recordsResult = table.createRecords([
   *   new Map([['fld123', 'John'], ['Age', 30]]),
   *   new Map([['fld123', 'Jane'], ['Age', 25]]),
   * ]);
   * ```
   */
  createRecords(
    recordsFieldValues: ReadonlyArray<
      ReadonlyMap<string, unknown> | { id?: RecordId; fieldValues: ReadonlyMap<string, unknown> }
    >,
    options?: {
      typecast?: boolean;
      valuesAreValidated?: boolean;
      emitRecordCreatedEvents?: boolean;
      source?: RecordCreateSource;
    }
  ): Result<CreateRecordsMethodResult, DomainError> {
    return createRecordsMethod.call(this, recordsFieldValues, options);
  }

  /**
   * Create records in a streaming/batched fashion using a Generator.
   *
   * This method is memory-friendly for large record sets:
   * - Lazily processes input records
   * - Yields batches of created records
   * - Only keeps batchSize records in memory at a time
   * - Stops immediately on first validation error
   *
   * @param recordsFieldValues - Iterable of field value maps (can be lazy/streaming)
   * @param options - Optional configuration
   * @param options.batchSize - Number of records per batch (default: 500)
   * @returns Generator yielding Result batches of created records
   *
   * @example
   * ```typescript
   * // Process 100k records with bounded memory
   * function* generateRecords() {
   *   for (let i = 0; i < 100000; i++) {
   *     yield new Map([['fld123', `Record ${i}`]]);
   *   }
   * }
   *
   * for (const batchResult of table.createRecordsStream(generateRecords(), { batchSize: 500 })) {
   *   if (batchResult.isErr()) {
   *     console.error(batchResult.error);
   *     break;
   *   }
   *   // Process batch of 500 records
   *   await repository.insertMany(batchResult.value);
   * }
   * ```
   */
  *createRecordsStream(
    recordsFieldValues: Iterable<ReadonlyMap<string, unknown>>,
    options?: CreateRecordsStreamOptions
  ): Generator<Result<ReadonlyArray<TableRecord>, DomainError>> {
    yield* createRecordsStreamMethod.call(this, recordsFieldValues, options);
  }

  /**
   * Async version of createRecordsStream for AsyncIterable sources.
   * Useful for streaming from URLs or large files without loading into memory.
   *
   * @param recordsFieldValues - An async iterable yielding Maps of field ID -> value
   * @param options.batchSize - Number of records per batch (default: 500)
   * @returns An async generator yielding Results containing batches of TableRecords
   */
  async *createRecordsStreamAsync(
    recordsFieldValues: AsyncIterable<ReadonlyMap<string, unknown>>,
    options?: CreateRecordsStreamOptions
  ): AsyncGenerator<Result<ReadonlyArray<TableRecord>, DomainError>> {
    yield* createRecordsStreamAsyncMethod.call(this, recordsFieldValues, options);
  }

  viewIds(): ReadonlyArray<ViewId> {
    return this.viewsValue.map((v) => v.id());
  }

  markDeleted(): Result<void, DomainError> {
    this.addDomainEvent(
      TableDeleted.create({
        tableId: this.id(),
        baseId: this.baseIdValue,
        tableName: this.nameValue,
        fieldIds: this.fieldIds(),
        viewIds: this.viewIds(),
      })
    );
    return ok(undefined);
  }

  markTrashed(): Result<void, DomainError> {
    this.addDomainEvent(
      TableTrashed.create({
        tableId: this.id(),
        baseId: this.baseIdValue,
        tableName: this.nameValue,
        fieldIds: this.fieldIds(),
        viewIds: this.viewIds(),
      })
    );
    return ok(undefined);
  }

  markRestored(): Result<void, DomainError> {
    this.addDomainEvent(
      TableRestored.create({
        tableId: this.id(),
        baseId: this.baseIdValue,
        tableName: this.nameValue,
        fieldIds: this.fieldIds(),
        viewIds: this.viewIds(),
      })
    );
    return ok(undefined);
  }

  requestActionTrigger(params: {
    actionKey: ITableActionKey;
    payload?: Record<string, unknown>;
    tableId?: TableId;
    baseId?: BaseId;
  }): void {
    this.addDomainEvent(
      TableActionTriggerRequested.create({
        tableId: params.tableId ?? this.id(),
        baseId: params.baseId ?? this.baseIdValue,
        actionKey: params.actionKey,
        payload: params.payload,
      })
    );
  }

  update(build: (mutator: TableMutator) => TableMutator): Result<TableUpdateResult, DomainError> {
    const mutator = build(TableMutator.create(this));
    return mutator.apply();
  }

  createView(input: TableCreateViewInput): Result<TableCreateViewResult, DomainError> {
    return createViewMethod.call(this, input);
  }

  applyViewSnapshot(snapshotView: View): Result<TableApplyViewSnapshotResult, DomainError> {
    return applyViewSnapshotMethod.call(this, snapshotView);
  }

  deleteView(viewId: ViewId): Result<TableDeleteViewResult, DomainError> {
    return deleteViewMethod.call(this, viewId);
  }

  duplicateView(
    sourceViewId: ViewId,
    options?: TableDuplicateViewOptions
  ): Result<TableDuplicateViewResult, DomainError> {
    return duplicateViewMethod.call(this, sourceViewId, options);
  }

  renameView(viewId: ViewId, nextName: ViewName): Result<TableRenameViewResult, DomainError> {
    return renameViewMethod.call(this, viewId, nextName);
  }

  updateViewDescription(
    viewId: ViewId,
    nextDescription: string
  ): Result<TableUpdateViewDescriptionResult, DomainError> {
    return updateViewDescriptionMethod.call(this, viewId, nextDescription);
  }

  updateViewFilter(
    viewId: ViewId,
    filter: unknown
  ): Result<TableUpdateViewFilterResult, DomainError> {
    return updateViewFilterMethod.call(this, viewId, filter);
  }

  updateViewGroup(viewId: ViewId, group: unknown): Result<TableUpdateViewGroupResult, DomainError> {
    return updateViewGroupMethod.call(this, viewId, group);
  }

  updateViewOptions(
    viewId: ViewId,
    patch: unknown
  ): Result<TableUpdateViewOptionsResult, DomainError> {
    return updateViewOptionsMethod.call(this, viewId, patch);
  }

  updateViewShareMeta(
    viewId: ViewId,
    shareMeta: unknown
  ): Result<UpdateViewShareMetaMethodResult, DomainError> {
    return updateViewShareMetaMethod.call(this, viewId, shareMeta);
  }

  refreshViewShareId(viewId: ViewId): Result<TableRefreshViewShareIdResult, DomainError> {
    return refreshViewShareIdMethod.call(this, viewId);
  }

  enableViewShare(viewId: ViewId): Result<TableEnableViewShareResult, DomainError> {
    return enableViewShareMethod.call(this, viewId);
  }

  disableViewShare(viewId: ViewId): Result<TableDisableViewShareResult, DomainError> {
    return disableViewShareMethod.call(this, viewId);
  }

  updateViewSort(viewId: ViewId, sort: unknown): Result<TableUpdateViewSortResult, DomainError> {
    return updateViewSortMethod.call(this, viewId, sort);
  }

  applyViewManualSort(
    viewId: ViewId,
    sort: unknown
  ): Result<TableApplyViewManualSortResult, DomainError> {
    return applyViewManualSortMethod.call(this, viewId, sort);
  }

  updateViewLocked(
    viewId: ViewId,
    nextIsLocked: boolean | undefined
  ): Result<TableUpdateViewLockedResult, DomainError> {
    return updateViewLockedMethod.call(this, viewId, nextIsLocked);
  }

  updateViewOrder(
    sourceViewId: ViewId,
    anchorViewId: ViewId,
    position: ViewOrderPosition
  ): Result<TableUpdateViewOrderResult, DomainError> {
    return updateViewOrderMethod.call(this, sourceViewId, anchorViewId, position);
  }

  updateViewColumnMeta(
    viewId: ViewId,
    patches: ReadonlyArray<ViewColumnMetaPatch>
  ): Result<TableUpdateViewColumnMetaResult, DomainError> {
    return updateViewColumnMetaMethod.call(this, viewId, patches);
  }

  clearViewFilterDependencies(
    viewId: ViewId,
    fieldIds: ReadonlyArray<FieldId>
  ): Result<TableUpdateResult | undefined, DomainError> {
    return clearViewFilterDependenciesMethod.call(this, viewId, fieldIds);
  }

  updateField(
    fieldId: FieldId,
    buildSpecs: (
      currentField: Field
    ) => Result<ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>, DomainError>,
    options?: { foreignTables?: ReadonlyArray<Table> }
  ): Result<
    {
      previousField: Field;
      updatedField: Field;
      specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
      updateResult: TableUpdateResult;
    },
    DomainError
  > {
    const currentFieldResult = this.getField((field) => field.id().equals(fieldId));
    if (currentFieldResult.isErr()) return err(currentFieldResult.error);
    const previousField = currentFieldResult.value;

    const specsResult = buildSpecs(previousField);
    if (specsResult.isErr()) return err(specsResult.error);
    const appliedSpecs = specsResult.value;

    const updateResult = this.update((mutator) =>
      mutator.updateField(fieldId, appliedSpecs, options)
    );
    if (updateResult.isErr()) return err(updateResult.error);

    const updatedFieldResult = updateResult.value.table.getField((field) =>
      field.id().equals(fieldId)
    );
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return ok({
      previousField,
      updatedField: updatedFieldResult.value,
      specs: appliedSpecs,
      updateResult: updateResult.value,
    });
  }

  updateFieldWithSpecs(
    fieldId: FieldId,
    specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>,
    options?: { foreignTables?: ReadonlyArray<Table> }
  ): Result<
    {
      updatedField: Field;
      specs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
      updateResult: TableUpdateResult;
    },
    DomainError
  > {
    const updateResult = this.update((mutator) => mutator.updateField(fieldId, specs, options));
    if (updateResult.isErr()) return err(updateResult.error);

    const updatedFieldResult = updateResult.value.table.getField((field) =>
      field.id().equals(fieldId)
    );
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    return ok({
      updatedField: updatedFieldResult.value,
      specs,
      updateResult: updateResult.value,
    });
  }

  rename(nextName: TableName): Result<Table, DomainError> {
    return renameMethod.call(this, nextName);
  }

  updateProperties(patch: TablePropertiesPatch): Result<Table, DomainError> {
    return updatePropertiesMethod.call(this, patch);
  }

  addField(
    field: Field,
    options?: {
      foreignTables?: ReadonlyArray<Table>;
      domainContext?: IDomainContext;
      targetViewId?: ViewId;
    }
  ): Result<Table, DomainError> {
    if (this.fieldsValue.some((existing) => existing.id().equals(field.id()))) {
      return err(domainError.conflict({ message: 'Field already exists' }));
    }
    if (this.fieldsValue.some((existing) => existing.name().equals(field.name()))) {
      return err(domainError.conflict({ message: 'Field names must be unique' }));
    }

    const nextDbFieldNameResult = field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
    if (nextDbFieldNameResult.isOk()) {
      const hasDuplicateDbFieldName = this.fieldsValue.some((existing) => {
        const existingDbFieldNameResult = existing
          .dbFieldName()
          .andThen((dbFieldName) => dbFieldName.value());
        return (
          existingDbFieldNameResult.isOk() &&
          existingDbFieldNameResult.value === nextDbFieldNameResult.value
        );
      });

      if (hasDuplicateDbFieldName) {
        return err(
          domainError.conflict({
            message: `Db Field name ${nextDbFieldNameResult.value} already exists in this table`,
          })
        );
      }
    }

    const validationResult = this.validateForeignTables([field], options?.foreignTables);
    if (validationResult.isErr()) return err(validationResult.error);

    const nextFields = [...this.fieldsValue, field];
    const nextViewsResult = this.cloneViewsWithField(nextFields, field, {
      targetViewId: options?.targetViewId,
    });
    if (nextViewsResult.isErr()) return err(nextViewsResult.error);

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: nextFields,
      views: nextViewsResult.value,
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props).andThen((nextTable) => {
      const resolved = field.type().equals(FieldType.formula())
        ? resolveFormulaFields(nextTable, {
            ignoreMissingReferenceOnExisting: true,
            strictFieldId: field.id(),
          })
        : ok(undefined);
      if (resolved.isErr()) return err(resolved.error);
      return ok(nextTable);
    });
  }

  addView(view: View): Result<Table, DomainError> {
    if (this.viewsValue.some((existing) => existing.id().equals(view.id()))) {
      return err(domainError.conflict({ message: 'View already exists' }));
    }
    if (this.viewsValue.some((existing) => existing.name().equals(view.name()))) {
      return err(domainError.conflict({ message: 'View names must be unique' }));
    }
    const columnMetaResult = view.columnMeta();
    if (columnMetaResult.isErr()) return err(columnMetaResult.error);
    const queryDefaultsResult = view.queryDefaults();
    if (queryDefaultsResult.isErr()) return err(queryDefaultsResult.error);

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: this.fieldsValue,
      views: [...this.viewsValue, view],
      primaryFieldId: this.primaryFieldIdValue,
    };
    if (this.dbTableNameValue.isRehydrated()) props.dbTableName = this.dbTableNameValue;
    return Table.rehydrate(props);
  }

  removeView(viewId: ViewId): Result<Table, DomainError> {
    if (this.viewsValue.length <= 1) {
      return err(
        domainError.validation({
          code: 'view.cannot_delete_last',
          message: 'Cannot delete the last view in a table. A table must have at least one view.',
        })
      );
    }

    const targetView = this.viewsValue.find((view) => view.id().equals(viewId));
    if (!targetView) {
      return err(
        domainError.notFound({
          code: 'view.not_found',
          message: `View not found: ${viewId.toString()}`,
        })
      );
    }

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: this.fieldsValue,
      views: this.viewsValue.filter((view) => !view.id().equals(viewId)),
      primaryFieldId: this.primaryFieldIdValue,
    };
    if (this.dbTableNameValue.isRehydrated()) props.dbTableName = this.dbTableNameValue;
    return Table.rehydrate(props);
  }

  removeField(fieldId: FieldId): Result<Table, DomainError> {
    if (this.primaryFieldIdValue.equals(fieldId)) {
      return err(
        domainError.forbidden({
          code: 'forbidden.table.delete_primary_field',
          message: 'Cannot delete primary field',
        })
      );
    }

    const targetField = this.fieldsValue.find((field) => field.id().equals(fieldId));
    if (!targetField) return err(domainError.notFound({ message: 'Field not found' }));

    const nextFields = this.fieldsValue.filter((field) => !field.id().equals(fieldId));
    if (nextFields.length === 0)
      return err(domainError.unexpected({ message: 'Table requires at least one Field' }));

    const nextViewsResult = this.cloneViewsWithoutField(nextFields, fieldId);
    if (nextViewsResult.isErr()) return err(nextViewsResult.error);

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: nextFields,
      views: nextViewsResult.value,
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props).map((nextTable) => {
      return nextTable;
    });
  }

  addSelectOptions(
    fieldId: FieldId,
    options: ReadonlyArray<SelectOption>,
    domainContext?: IDomainContext
  ): Result<Table, DomainError> {
    if (options.length === 0) {
      return ok(this);
    }

    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    if (
      !field.type().equals(FieldType.singleSelect()) &&
      !field.type().equals(FieldType.multipleSelect())
    ) {
      return err(domainError.validation({ message: 'Field is not a select field' }));
    }

    const isSingle = field.type().equals(FieldType.singleSelect());
    const existingOptions = isSingle
      ? (field as SingleSelectField).selectOptions()
      : (field as MultipleSelectField).selectOptions();
    const existingIds = new Set(existingOptions.map((option) => option.id().toString()));
    const existingNames = new Set(existingOptions.map((option) => option.name().toString()));
    const newOptions = options.filter(
      (option) =>
        !existingIds.has(option.id().toString()) && !existingNames.has(option.name().toString())
    );
    if (newOptions.length === 0) {
      return ok(this);
    }

    const mergedOptions = [...existingOptions, ...newOptions];
    const limitResult = ensureSelectFieldOptionCountWithinLimit(
      mergedOptions.length,
      domainContext
    );
    if (limitResult.isErr()) return err(limitResult.error);
    const nameLimitResult = ensureSelectFieldOptionNamesWithinLimit(
      mergedOptions.map((option) => option.name().toString()),
      domainContext
    );
    if (nameLimitResult.isErr()) return err(nameLimitResult.error);

    const nextFieldResult = isSingle
      ? SingleSelectField.create({
          id: field.id(),
          name: field.name(),
          options: mergedOptions,
          defaultValue: (field as SingleSelectField).defaultValue(),
          preventAutoNewOptions: (field as SingleSelectField).preventAutoNewOptions(),
          domainContext,
        })
      : MultipleSelectField.create({
          id: field.id(),
          name: field.name(),
          options: mergedOptions,
          defaultValue: (field as MultipleSelectField).defaultValue(),
          preventAutoNewOptions: (field as MultipleSelectField).preventAutoNewOptions(),
          domainContext,
        });
    if (nextFieldResult.isErr()) return err(nextFieldResult.error);
    const nextField = nextFieldResult.value;

    const setDescriptionResult = nextField.setDescription(field.description());
    if (setDescriptionResult.isErr()) return err(setDescriptionResult.error);
    const setAiConfigResult = nextField.setAiConfig(field.aiConfig());
    if (setAiConfigResult.isErr()) return err(setAiConfigResult.error);
    const setNotNullResult = nextField.setNotNull(field.notNull());
    if (setNotNullResult.isErr()) return err(setNotNullResult.error);
    const setUniqueResult = nextField.setUnique(field.unique());
    if (setUniqueResult.isErr()) return err(setUniqueResult.error);

    const dbFieldNameResult = field.dbFieldName();
    if (dbFieldNameResult.isOk()) {
      const setDbFieldNameResult = nextField.setDbFieldName(dbFieldNameResult.value);
      if (setDbFieldNameResult.isErr()) return err(setDbFieldNameResult.error);
    }

    const dbFieldTypeResult = field.dbFieldType();
    if (dbFieldTypeResult.isOk()) {
      const setDbFieldTypeResult = nextField.setDbFieldType(dbFieldTypeResult.value);
      if (setDbFieldTypeResult.isErr()) return err(setDbFieldTypeResult.error);
    }

    const nextFields = this.fieldsValue.map((current) =>
      current.id().equals(fieldId) ? nextField : current
    );

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: nextFields,
      views: this.viewsValue,
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props);
  }
  /**
   * Update a field's name.
   * @param fieldId - The field to update
   * @param nextName - The new name
   * @returns Result containing the updated table or an error
   */
  updateFieldName(fieldId: FieldId, nextName: FieldName): Result<Table, DomainError> {
    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;

    // Check for name uniqueness (excluding the current field)
    const nameConflict = this.fieldsValue.some(
      (f) => !f.id().equals(fieldId) && f.name().equals(nextName)
    );
    if (nameConflict) {
      return err(domainError.conflict({ message: 'Field names must be unique' }));
    }

    const updatedFieldResult = field.withName({
      newId: field.id(),
      newName: nextName,
      baseId: this.baseIdValue,
      tableId: this.id(),
    });
    if (updatedFieldResult.isErr()) return err(updatedFieldResult.error);

    const updatedField = updatedFieldResult.value;

    const descriptionResult = updatedField.setDescription(field.description());
    if (descriptionResult.isErr()) return err(descriptionResult.error);

    const dbFieldNameResult = field.dbFieldName();
    if (dbFieldNameResult.isOk()) {
      const setDbFieldNameResult = updatedField.setDbFieldName(dbFieldNameResult.value);
      if (setDbFieldNameResult.isErr()) return err(setDbFieldNameResult.error);
    }

    const dbFieldTypeResult = field.dbFieldType();
    if (dbFieldTypeResult.isOk()) {
      const setDbFieldTypeResult = updatedField.setDbFieldType(dbFieldTypeResult.value);
      if (setDbFieldTypeResult.isErr()) return err(setDbFieldTypeResult.error);
    }

    const nextFields = this.fieldsValue.map((f) => (f.id().equals(fieldId) ? updatedField : f));

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: nextFields,
      views: this.viewsValue,
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props);
  }

  updateFieldDescription(fieldId: FieldId, description: string | null): Result<Table, DomainError> {
    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    const setDescriptionResult = field.setDescription(description);
    if (setDescriptionResult.isErr()) return err(setDescriptionResult.error);

    return ok(this);
  }

  updateFieldDbFieldName(fieldId: FieldId, dbFieldName: DbFieldName): Result<Table, DomainError> {
    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    const renameResult = field.renameDbFieldName(dbFieldName);
    if (renameResult.isErr()) return err(renameResult.error);

    return ok(this);
  }

  /**
   * Replace a field with a new field (for type conversion).
   * The new field must have the same ID as the old field.
   * @param fieldId - The field to replace
   * @param newField - The new field instance
   * @returns Result containing the updated table or an error
   */
  replaceField(
    fieldId: FieldId,
    newField: Field,
    _options?: { foreignTables?: ReadonlyArray<Table> }
  ): Result<Table, DomainError> {
    if (!fieldId.equals(newField.id())) {
      return err(
        domainError.validation({ message: 'New field must have the same ID as the old field' })
      );
    }

    const oldFieldResult = this.getField((field) => field.id().equals(fieldId));
    if (oldFieldResult.isErr()) return err(oldFieldResult.error);
    const oldField = oldFieldResult.value;

    const oldDbFieldNameResult = oldField.dbFieldName();
    if (oldDbFieldNameResult.isOk() && newField.dbFieldName().isErr()) {
      const setDbFieldNameResult = newField.setDbFieldName(oldDbFieldNameResult.value);
      if (setDbFieldNameResult.isErr()) return err(setDbFieldNameResult.error);
    }
    // Same-type, same-multiplicity pending rebuilds omit dbFieldType.
    // Copy persisted scalar storage (REAL/DATETIME/BOOLEAN/INTEGER) when present.
    // If leftover TEXT/JSON metadata still points at a numeric/temporal/json inner
    // field, derive storage from that inner type so backfill recasts without a
    // physical-column catalog round trip.
    // Skip when lookup target or cellValueType changed (count REAL -> max DATETIME).
    // Pending lookups default to string, so skip the value-type check for them.
    if (oldField.type().equals(newField.type())) {
      const oldMultiple = oldField.isMultipleCellValue();
      const newMultiple = newField.isMultipleCellValue();
      const sameMultiplicity =
        oldMultiple.isOk() && newMultiple.isOk() && oldMultiple.value.equals(newMultiple.value);
      const sameLookupTarget =
        !(oldField instanceof LookupField) ||
        !(newField instanceof LookupField) ||
        oldField.lookupFieldId().equals(newField.lookupFieldId());
      const newIsPendingLookup = newField instanceof LookupField && newField.isPending();
      const oldValueType = oldField.accept(new FieldValueTypeVisitor());
      const newValueType = newField.accept(new FieldValueTypeVisitor());
      const sameValueType =
        newIsPendingLookup ||
        (oldValueType.isOk() &&
          newValueType.isOk() &&
          oldValueType.value.cellValueType.equals(newValueType.value.cellValueType));
      if (sameMultiplicity && sameLookupTarget && sameValueType) {
        const oldDbFieldTypeResult = oldField.dbFieldType();
        if (oldDbFieldTypeResult.isOk() && newField.dbFieldType().isErr()) {
          const persistedType = oldDbFieldTypeResult.value.value();
          if (persistedType.isOk() && isPersistedScalarDbFieldType(persistedType.value)) {
            const setDbFieldTypeResult = newField.setDbFieldType(oldDbFieldTypeResult.value);
            if (setDbFieldTypeResult.isErr()) return err(setDbFieldTypeResult.error);
          }
        }
        if (newField.dbFieldType().isErr() && newIsPendingLookup) {
          const derivedType = deriveDbFieldTypeFromResolvedField(oldField);
          if (derivedType) {
            const rehydrated = DbFieldType.rehydrate(derivedType);
            if (rehydrated.isErr()) return err(rehydrated.error);
            const setDerivedResult = newField.setDbFieldType(rehydrated.value);
            if (setDerivedResult.isErr()) return err(setDerivedResult.error);
          }
        }
      }
    }

    // Primary field conversion aligns with v1: conversion is allowed but target type is restricted.
    if (this.primaryFieldIdValue.equals(fieldId)) {
      if (!oldField.type().equals(newField.type())) {
        const nextType = newField.type().toString();
        if (!newField.type().isPrimarySupported()) {
          return err(
            domainError.validation({
              message: `Field type ${nextType} is not supported as primary field`,
            })
          );
        }
      }
    }

    if (!oldField.name().equals(newField.name())) {
      const nameConflict = this.fieldsValue.some(
        (f) => !f.id().equals(fieldId) && f.name().equals(newField.name())
      );
      if (nameConflict) {
        return err(domainError.conflict({ message: 'Field names must be unique' }));
      }
    }

    const nextFields = this.fieldsValue.map((f) => (f.id().equals(fieldId) ? newField : f));

    const props: ITableBuildProps = {
      id: this.id(),
      baseId: this.baseIdValue,
      name: this.nameValue,
      properties: this.propertiesValue,
      fields: nextFields,
      views: this.viewsValue,
      primaryFieldId: this.primaryFieldIdValue,
    };

    if (this.dbTableNameValue.isRehydrated()) {
      props.dbTableName = this.dbTableNameValue;
    }

    return Table.rehydrate(props).andThen((nextTable) => {
      const resolved = newField.type().equals(FieldType.formula())
        ? resolveFormulaFields(nextTable, {
            ignoreMissingReferenceOnExisting: true,
            strictFieldId: newField.id(),
          })
        : ok(undefined);
      if (resolved.isErr()) return err(resolved.error);
      return ok(nextTable);
    });
  }

  /**
   * Update a field's constraints (notNull, unique).
   * @param fieldId - The field to update
   * @param notNull - The new notNull constraint
   * @param unique - The new unique constraint
   * @returns Result containing the updated table or an error
   */
  updateFieldConstraints(
    fieldId: FieldId,
    notNull: FieldNotNull,
    unique: FieldUnique
  ): Result<Table, DomainError> {
    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;

    // Apply constraints to the field
    const setNotNullResult = field.setNotNull(notNull);
    if (setNotNullResult.isErr()) return err(setNotNullResult.error);

    const setUniqueResult = field.setUnique(unique);
    if (setUniqueResult.isErr()) return err(setUniqueResult.error);

    // Table structure doesn't change, just field state
    return ok(this);
  }

  /**
   * Update a field's error state.
   * Used when computed fields have broken references.
   * @param fieldId - The field to update
   * @param hasError - The new error state
   * @returns Result containing the updated table or an error
   */
  updateFieldHasError(fieldId: FieldId, hasError: FieldHasError): Result<Table, DomainError> {
    const fieldResult = this.getField((field) => field.id().equals(fieldId));
    if (fieldResult.isErr()) return err(fieldResult.error);

    const field = fieldResult.value;
    field.setHasError(hasError);

    // Table structure doesn't change, just field state
    return ok(this);
  }

  private validateForeignTables(
    fields: ReadonlyArray<Field>,
    foreignTables?: ReadonlyArray<Table>
  ): Result<void, DomainError> {
    if (!foreignTables || foreignTables.length === 0) return ok(undefined);
    return validateForeignTablesForFields(fields, { hostTable: this, foreignTables });
  }

  private cloneViewsWithField(
    fields: ReadonlyArray<Field>,
    newField: Field,
    options?: {
      targetViewId?: ViewId;
    }
  ): Result<ReadonlyArray<View>, DomainError> {
    const defaultMetaByType = new Map<string, ViewColumnMeta>();
    const newFieldKey = newField.id().toString();

    const clones = this.viewsValue.map((view) => {
      const currentMetaResult = view.columnMeta();
      if (currentMetaResult.isErr()) return err(currentMetaResult.error);
      const currentMeta = currentMetaResult.value.toDto();

      const viewType = view.type().toString();
      let defaultMeta = defaultMetaByType.get(viewType);
      if (!defaultMeta) {
        const metaResult = ViewColumnMeta.forView({
          viewType: view.type(),
          fields,
          primaryFieldId: this.primaryFieldIdValue,
        });
        if (metaResult.isErr()) return err(metaResult.error);
        defaultMeta = metaResult.value;
        defaultMetaByType.set(viewType, defaultMeta);
      }

      const defaultMetaDto = defaultMeta.toDto();
      const defaultEntry = defaultMetaDto[newFieldKey];
      if (!defaultEntry)
        return err(domainError.validation({ message: 'Missing new field column meta' }));

      const hydratedCurrentMeta = { ...currentMeta };
      const currentEntries = Object.values(currentMeta);
      let maxOrder = currentEntries.length
        ? Math.max(...currentEntries.map((entry) => entry.order ?? -1))
        : -1;

      for (const existingField of fields) {
        const fieldKey = existingField.id().toString();
        if (fieldKey === newFieldKey || typeof hydratedCurrentMeta[fieldKey]?.order === 'number') {
          continue;
        }

        const defaultExistingEntry = defaultMetaDto[fieldKey];
        if (!defaultExistingEntry) {
          return err(domainError.validation({ message: 'Missing existing field column meta' }));
        }

        maxOrder += 1;
        hydratedCurrentMeta[fieldKey] = {
          ...defaultExistingEntry,
          ...hydratedCurrentMeta[fieldKey],
          order: maxOrder,
        };
      }

      const nextEntry = this.buildAddedFieldColumnMetaEntry({
        view,
        currentMeta,
        defaultEntry,
        targetViewId: options?.targetViewId,
      });

      const nextMeta = {
        ...hydratedCurrentMeta,
        [newFieldKey]: { ...nextEntry, order: maxOrder + 1 },
      };

      const nextMetaResult = ViewColumnMeta.create(nextMeta);
      if (nextMetaResult.isErr()) return err(nextMetaResult.error);

      const cloneResult = view.accept(new CloneViewVisitor());
      if (cloneResult.isErr()) return err(cloneResult.error);

      const clone = cloneResult.value;
      const setResult = clone.setColumnMeta(nextMetaResult.value);
      if (setResult.isErr()) return err(setResult.error);

      const queryDefaultsResult = view.queryDefaults();
      if (queryDefaultsResult.isErr()) return err(queryDefaultsResult.error);
      const setQueryResult = clone.setQueryDefaults(queryDefaultsResult.value);
      if (setQueryResult.isErr()) return err(setQueryResult.error);

      return ok(clone);
    });

    return clones.reduce<Result<ReadonlyArray<View>, DomainError>>(
      (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
      ok([])
    );
  }

  private cloneViewsWithoutField(
    fields: ReadonlyArray<Field>,
    removedFieldId: FieldId
  ): Result<ReadonlyArray<View>, DomainError> {
    const removedKey = removedFieldId.toString();
    const clones = this.viewsValue.map((view) => {
      const currentMetaResult = view.columnMeta();
      if (currentMetaResult.isErr()) return err(currentMetaResult.error);
      const currentMeta = currentMetaResult.value.toDto();
      if (currentMeta[removedKey]) {
        delete currentMeta[removedKey];
      }

      const nextMetaResult = ViewColumnMeta.create(currentMeta);
      if (nextMetaResult.isErr()) return err(nextMetaResult.error);

      const cloneResult = view.accept(new CloneViewVisitor());
      if (cloneResult.isErr()) return err(cloneResult.error);

      const clone = cloneResult.value;
      const setResult = clone.setColumnMeta(nextMetaResult.value);
      if (setResult.isErr()) return err(setResult.error);

      const queryDefaultsResult = view.queryDefaults();
      if (queryDefaultsResult.isErr()) return err(queryDefaultsResult.error);
      const setQueryResult = clone.setQueryDefaults(queryDefaultsResult.value);
      if (setQueryResult.isErr()) return err(setQueryResult.error);

      return ok(clone);
    });

    return clones.reduce<Result<ReadonlyArray<View>, DomainError>>(
      (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
      ok([])
    );
  }

  private buildAddedFieldColumnMetaEntry(params: {
    view: View;
    currentMeta: Record<string, ViewColumnMetaEntry>;
    defaultEntry: ViewColumnMetaEntry;
    targetViewId?: ViewId;
  }): ViewColumnMetaEntry {
    const { view, currentMeta, defaultEntry, targetViewId } = params;

    if (targetViewId && view.id().equals(targetViewId)) {
      return { ...defaultEntry };
    }

    if (view.type().toString() !== 'grid') {
      return { ...defaultEntry };
    }

    const hasExplicitHiddenVisibilityConfig = Object.values(currentMeta).some((entry) =>
      Object.prototype.hasOwnProperty.call(entry, 'hidden')
    );
    if (!hasExplicitHiddenVisibilityConfig) {
      return { ...defaultEntry };
    }

    return {
      ...defaultEntry,
      hidden: true,
    };
  }
}
