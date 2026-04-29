import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { IDomainEvent } from '../../../shared/DomainEvent';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { FieldCreated } from '../../events/FieldCreated';
import { FieldDeleted } from '../../events/FieldDeleted';
import { FieldDuplicated } from '../../events/FieldDuplicated';
import { FieldOptionsAdded } from '../../events/FieldOptionsAdded';
import { FieldUpdated } from '../../events/FieldUpdated';
import type { FieldUpdatedValueChange } from '../../events/FieldUpdated';
import { TableRenamed } from '../../events/TableRenamed';
import { ViewColumnMetaUpdated } from '../../events/ViewColumnMetaUpdated';
import { Field } from '../../fields/Field';
import type { FieldId } from '../../fields/FieldId';
import { FieldOptionsDtoVisitor } from '../../fields/visitors/FieldOptionsDtoVisitor';
import type { Table } from '../../Table';
import type {
  RemoveSymmetricLinkFieldSpec,
  UpdateButtonColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonWorkflowSpec,
  UpdateCheckboxDefaultValueSpec,
  UpdateDateDefaultValueSpec,
  UpdateDateFormattingSpec,
  UpdateFormulaExpressionSpec,
  UpdateFormulaFormattingSpec,
  UpdateFormulaShowAsSpec,
  UpdateFormulaTimeZoneSpec,
  UpdateLinkConfigSpec,
  UpdateLinkRelationshipSpec,
  UpdateLongTextDefaultValueSpec,
  UpdateLongTextShowAsSpec,
  UpdateLookupOptionsSpec,
  UpdateMultipleSelectAutoNewOptionsSpec,
  UpdateMultipleSelectDefaultValueSpec,
  UpdateMultipleSelectOptionsSpec,
  UpdateNumberDefaultValueSpec,
  UpdateNumberFormattingSpec,
  UpdateNumberShowAsSpec,
  UpdateRatingColorSpec,
  UpdateRatingIconSpec,
  UpdateRatingMaxSpec,
  UpdateRollupConfigSpec,
  UpdateRollupExpressionSpec,
  UpdateRollupFormattingSpec,
  UpdateRollupShowAsSpec,
  UpdateRollupTimeZoneSpec,
  UpdateSingleLineTextDefaultValueSpec,
  UpdateSingleLineTextShowAsSpec,
  UpdateSingleSelectAutoNewOptionsSpec,
  UpdateSingleSelectDefaultValueSpec,
  UpdateSingleSelectOptionsSpec,
  UpdateUserDefaultValueSpec,
  UpdateUserMultiplicitySpec,
  UpdateUserNotificationSpec,
} from '../field-updates';
import type { ITableSpecVisitor } from '../ITableSpecVisitor';
import type { TableAddFieldSpec } from '../TableAddFieldSpec';
import type { TableAddFieldsSpec } from '../TableAddFieldsSpec';
import type { TableAddSelectOptionsSpec } from '../TableAddSelectOptionsSpec';
import type { TableByBaseIdSpec } from '../TableByBaseIdSpec';
import type { TableByIdSpec } from '../TableByIdSpec';
import type { TableByIdsSpec } from '../TableByIdsSpec';
import type { TableByIncomingReferenceToTableSpec } from '../TableByIncomingReferenceToTableSpec';
import type { TableByNameLikeSpec } from '../TableByNameLikeSpec';
import type { TableByNameSpec } from '../TableByNameSpec';
import type { TableDuplicateFieldSpec } from '../TableDuplicateFieldSpec';
import type { TableRemoveFieldSpec } from '../TableRemoveFieldSpec';
import type { TableRenameSpec } from '../TableRenameSpec';
import type { TableUpdateFieldAiConfigSpec } from '../TableUpdateFieldAiConfigSpec';
import type { TableUpdateFieldConstraintsSpec } from '../TableUpdateFieldConstraintsSpec';
import type { TableUpdateFieldDbFieldNameSpec } from '../TableUpdateFieldDbFieldNameSpec';
import type { TableUpdateFieldDescriptionSpec } from '../TableUpdateFieldDescriptionSpec';
import type { TableUpdateFieldHasErrorSpec } from '../TableUpdateFieldHasErrorSpec';
import type { TableUpdateFieldNameSpec } from '../TableUpdateFieldNameSpec';
import type { TableUpdateFieldTypeSpec } from '../TableUpdateFieldTypeSpec';
import type { TableUpdateViewColumnMetaSpec } from '../TableUpdateViewColumnMetaSpec';
import type { TableUpdateViewQueryDefaultsSpec } from '../TableUpdateViewQueryDefaultsSpec';
import { FieldUpdateSemanticsVisitor } from './FieldUpdateSemanticsVisitor';

/**
 * A visitor that generates domain events based on the specs it visits.
 * Used by TableMutator to generate events after applying mutations.
 */
export class TableEventGeneratingSpecVisitor implements ITableSpecVisitor<void> {
  private readonly events: IDomainEvent[] = [];
  private readonly fieldUpdateSemanticsVisitor = new FieldUpdateSemanticsVisitor();

  constructor(private readonly table: Table) {}

  getEvents(): ReadonlyArray<IDomainEvent> {
    return this.events;
  }

  visit(_spec: ISpecification<unknown, ITableSpecVisitor>): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec): Result<void, DomainError> {
    const viewOrdersResult = this.collectViewOrders(spec.field().id());
    if (viewOrdersResult.isErr()) {
      return err(viewOrdersResult.error);
    }

    this.events.push(
      FieldCreated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.field().id(),
        viewOrders: viewOrdersResult.value,
      })
    );
    return ok(undefined);
  }

  visitTableAddFields(spec: TableAddFieldsSpec): Result<void, DomainError> {
    for (const field of spec.fields()) {
      const viewOrdersResult = this.collectViewOrders(field.id());
      if (viewOrdersResult.isErr()) {
        return err(viewOrdersResult.error);
      }

      this.events.push(
        FieldCreated.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          fieldId: field.id(),
          viewOrders: viewOrdersResult.value,
        })
      );
    }
    return ok(undefined);
  }

  private collectViewOrders(
    fieldId: FieldId
  ): Result<Readonly<Record<string, number>>, DomainError> {
    const fieldIdStr = fieldId.toString();
    const viewOrders: Record<string, number> = {};

    for (const view of this.table.views()) {
      const viewMetaResult = view.columnMeta();
      if (viewMetaResult.isErr()) {
        return err(viewMetaResult.error);
      }
      const order = viewMetaResult.value.toDto()[fieldIdStr]?.order;
      if (typeof order === 'number') {
        viewOrders[view.id().toString()] = order;
      }
    }

    return ok(viewOrders);
  }

  visitTableAddSelectOptions(spec: TableAddSelectOptionsSpec): Result<void, DomainError> {
    const options = spec.options();
    if (options.length > 0) {
      this.events.push(
        FieldOptionsAdded.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          fieldId: spec.fieldId(),
          options,
        })
      );
    }
    return ok(undefined);
  }

  visitTableDuplicateField(spec: TableDuplicateFieldSpec): Result<void, DomainError> {
    const viewOrdersResult = this.collectViewOrders(spec.newField().id());
    if (viewOrdersResult.isErr()) {
      return err(viewOrdersResult.error);
    }

    this.events.push(
      FieldDuplicated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        sourceFieldId: spec.sourceField().id(),
        newFieldId: spec.newField().id(),
        includeRecordValues: spec.includeRecordValues(),
      }),
      FieldCreated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.newField().id(),
        viewOrders: viewOrdersResult.value,
      })
    );
    return ok(undefined);
  }

  visitTableRemoveField(spec: TableRemoveFieldSpec): Result<void, DomainError> {
    this.events.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.field().id(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(spec: TableUpdateViewColumnMetaSpec): Result<void, DomainError> {
    for (const update of spec.updates()) {
      this.events.push(
        ViewColumnMetaUpdated.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          viewId: update.viewId,
          fieldId: update.fieldId,
        })
      );
    }
    return ok(undefined);
  }

  visitTableUpdateViewQueryDefaults(
    _spec: TableUpdateViewQueryDefaultsSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRename(spec: TableRenameSpec): Result<void, DomainError> {
    this.events.push(
      TableRenamed.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        previousName: spec.previousName(),
        nextName: spec.nextName(),
      })
    );
    return ok(undefined);
  }

  // Query specs do not generate events
  visitTableByBaseId(_spec: TableByBaseIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableById(_spec: TableByIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByIncomingReferenceToTable(
    _spec: TableByIncomingReferenceToTableSpec
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByIds(_spec: TableByIdsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByName(_spec: TableByNameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByNameLike(_spec: TableByNameLikeSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  // Field update specs - generate FieldUpdated events
  visitTableUpdateFieldName(spec: TableUpdateFieldNameSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldDbFieldName(
    spec: TableUpdateFieldDbFieldNameSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldType(spec: TableUpdateFieldTypeSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.newField().id());
    return ok(undefined);
  }

  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldAiConfig(spec: TableUpdateFieldAiConfigSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldDescription(
    spec: TableUpdateFieldDescriptionSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldHasError(spec: TableUpdateFieldHasErrorSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // ============ Field-type-specific update specs ============

  // SingleLineText
  visitUpdateSingleLineTextShowAs(spec: UpdateSingleLineTextShowAsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateSingleLineTextDefaultValue(
    spec: UpdateSingleLineTextDefaultValueSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // LongText
  visitUpdateLongTextShowAs(spec: UpdateLongTextShowAsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateLongTextDefaultValue(spec: UpdateLongTextDefaultValueSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Number
  visitUpdateNumberFormatting(spec: UpdateNumberFormattingSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateNumberShowAs(spec: UpdateNumberShowAsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateNumberDefaultValue(spec: UpdateNumberDefaultValueSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Date
  visitUpdateDateFormatting(spec: UpdateDateFormattingSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateDateDefaultValue(spec: UpdateDateDefaultValueSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Checkbox
  visitUpdateCheckboxDefaultValue(spec: UpdateCheckboxDefaultValueSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Rating
  visitUpdateRatingMax(spec: UpdateRatingMaxSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRatingIcon(spec: UpdateRatingIconSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRatingColor(spec: UpdateRatingColorSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // User
  visitUpdateUserMultiplicity(spec: UpdateUserMultiplicitySpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateUserNotification(spec: UpdateUserNotificationSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateUserDefaultValue(spec: UpdateUserDefaultValueSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Button
  visitUpdateButtonLabel(spec: UpdateButtonLabelSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateButtonColor(spec: UpdateButtonColorSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateButtonMaxCount(spec: UpdateButtonMaxCountSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateButtonWorkflow(spec: UpdateButtonWorkflowSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // SingleSelect
  visitUpdateSingleSelectOptions(spec: UpdateSingleSelectOptionsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateSingleSelectDefaultValue(
    spec: UpdateSingleSelectDefaultValueSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateSingleSelectAutoNewOptions(
    spec: UpdateSingleSelectAutoNewOptionsSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // MultipleSelect
  visitUpdateMultipleSelectOptions(
    spec: UpdateMultipleSelectOptionsSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateMultipleSelectDefaultValue(
    spec: UpdateMultipleSelectDefaultValueSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateMultipleSelectAutoNewOptions(
    spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Formula
  visitUpdateFormulaExpression(spec: UpdateFormulaExpressionSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateFormulaFormatting(spec: UpdateFormulaFormattingSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateFormulaShowAs(spec: UpdateFormulaShowAsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateFormulaTimeZone(spec: UpdateFormulaTimeZoneSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Link
  visitUpdateLinkConfig(spec: UpdateLinkConfigSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateLinkRelationship(spec: UpdateLinkRelationshipSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Lookup
  visitUpdateLookupOptions(spec: UpdateLookupOptionsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  // Rollup
  visitUpdateRollupConfig(spec: UpdateRollupConfigSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupExpression(spec: UpdateRollupExpressionSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupFormatting(spec: UpdateRollupFormattingSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupShowAs(spec: UpdateRollupShowAsSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitUpdateRollupTimeZone(spec: UpdateRollupTimeZoneSpec): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  private pushFieldUpdated(spec: object, fieldId: FieldId): void {
    const semantics = this.fieldUpdateSemanticsVisitor.visit(spec);
    if (!semantics) {
      return;
    }

    this.events.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId,
        updatedProperties: semantics.updatedProperties,
        changes: this.extractChanges(spec, semantics.updatedProperties),
        propertySemantics: semantics.propertySemantics,
      })
    );
  }

  private extractChanges(
    spec: object,
    updatedProperties: ReadonlyArray<string>
  ): Readonly<Record<string, FieldUpdatedValueChange>> {
    const entries: Array<[string, FieldUpdatedValueChange]> = [];

    for (const property of updatedProperties) {
      const change = this.extractChangeByProperty(spec, property);
      if (!change) continue;
      entries.push([property, change]);
    }

    return Object.fromEntries(entries);
  }

  private extractChangeByProperty(
    spec: object,
    property: string
  ): FieldUpdatedValueChange | undefined {
    const direct = this.extractDirectPropertyChange(spec, property);
    if (direct) return direct;

    if (property === 'type') {
      const oldField = this.callSpecAccessor(spec, 'oldField');
      const newField = this.callSpecAccessor(spec, 'newField');
      if (!oldField && !newField) return undefined;
      return {
        oldValue: this.fieldTypeOf(oldField),
        newValue: this.fieldTypeOf(newField),
      };
    }

    if (property === 'options') {
      const oldField = this.callSpecAccessor(spec, 'oldField');
      const newField = this.callSpecAccessor(spec, 'newField');
      if (!oldField && !newField) return undefined;
      return {
        oldValue: this.fieldOptionsOf(oldField),
        newValue: this.fieldOptionsOf(newField),
      };
    }

    if (property === 'linkRelationship') {
      const previousConfig = this.callSpecAccessor(spec, 'previousConfig');
      const nextConfig = this.callSpecAccessor(spec, 'nextConfig');
      if (!previousConfig && !nextConfig) return undefined;
      return { oldValue: previousConfig, newValue: nextConfig };
    }

    return undefined;
  }

  private extractDirectPropertyChange(
    spec: object,
    property: string
  ): FieldUpdatedValueChange | undefined {
    const methodSuffix = property.slice(0, 1).toUpperCase() + property.slice(1);
    const oldValue = this.callSpecAccessor(spec, `previous${methodSuffix}`);
    const newValue = this.callSpecAccessor(spec, `next${methodSuffix}`);

    if (oldValue === undefined && newValue === undefined) {
      return undefined;
    }

    return {
      oldValue,
      newValue,
    };
  }

  private callSpecAccessor(spec: object, accessorName: string): unknown {
    const accessor = (spec as Record<string, unknown>)[accessorName];
    if (typeof accessor !== 'function') {
      return undefined;
    }
    return (accessor as () => unknown).call(spec);
  }

  private fieldTypeOf(field: unknown): string | undefined {
    if (!(field instanceof Object) || !('type' in field)) {
      return undefined;
    }

    const typeAccessor = (field as { type?: unknown }).type;
    if (typeof typeAccessor !== 'function') {
      return undefined;
    }

    const fieldType = (typeAccessor as () => unknown).call(field);
    if (!(fieldType instanceof Object) || !('toString' in fieldType)) {
      return undefined;
    }

    return (fieldType as { toString: () => string }).toString();
  }

  private fieldOptionsOf(field: unknown): unknown {
    if (!(field instanceof Field)) return {};
    const result = field.accept(new FieldOptionsDtoVisitor());
    return result.isOk() ? result.value : {};
  }

  // RemoveSymmetricLinkField - generates FieldDeleted event
  visitRemoveSymmetricLinkField(spec: RemoveSymmetricLinkFieldSpec): Result<void, DomainError> {
    this.events.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
      })
    );
    return ok(undefined);
  }
}
