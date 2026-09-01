import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { IDomainEvent } from '../../../shared/DomainEvent';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { FieldCreated } from '../../events/FieldCreated';
import { FieldDeleted } from '../../events/FieldDeleted';
import { FieldUpdated } from '../../events/FieldUpdated';
import { TablePropertiesUpdated } from '../../events/TablePropertiesUpdated';
import { TableRenamed } from '../../events/TableRenamed';
import { ViewColumnMetaUpdated } from '../../events/ViewColumnMetaUpdated';
import { ViewCreated } from '../../events/ViewCreated';
import { ViewDeleted } from '../../events/ViewDeleted';
import { ViewDescriptionUpdated } from '../../events/ViewDescriptionUpdated';
import { ViewFilterUpdated } from '../../events/ViewFilterUpdated';
import { ViewGroupUpdated } from '../../events/ViewGroupUpdated';
import { ViewLockedUpdated } from '../../events/ViewLockedUpdated';
import { ViewOptionsUpdated } from '../../events/ViewOptionsUpdated';
import { ViewOrderUpdated } from '../../events/ViewOrderUpdated';
import { ViewRenamed } from '../../events/ViewRenamed';
import { ViewShareDisabled } from '../../events/ViewShareDisabled';
import { ViewShareEnabled } from '../../events/ViewShareEnabled';
import { ViewShareIdRefreshed } from '../../events/ViewShareIdRefreshed';
import { ViewShareMetaUpdated } from '../../events/ViewShareMetaUpdated';
import { ViewSortUpdated } from '../../events/ViewSortUpdated';
import type { FieldId } from '../../fields/FieldId';
import type { Table } from '../../Table';
import { viewGroupDtoFromQueryDefaults } from '../../views/ViewGroup';
import { viewSortDtoFromQueryDefaults } from '../../views/ViewSort';
import type {
  RemoveSymmetricLinkFieldSpec,
  UpdateButtonColorSpec,
  UpdateButtonLabelSpec,
  UpdateButtonMaxCountSpec,
  UpdateButtonResetCountSpec,
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
import type { TableAddViewSpec } from '../TableAddViewSpec';
import type { TableByBaseIdSpec } from '../TableByBaseIdSpec';
import type { TableByIdSpec } from '../TableByIdSpec';
import type { TableByIdsSpec } from '../TableByIdsSpec';
import type { TableByIncomingReferenceToTableSpec } from '../TableByIncomingReferenceToTableSpec';
import type { TableByNameLikeSpec } from '../TableByNameLikeSpec';
import type { TableByNameSpec } from '../TableByNameSpec';
import type { TableByViewIdSpec } from '../TableByViewIdSpec';
import type { TableDuplicateFieldSpec } from '../TableDuplicateFieldSpec';
import type { TableEnsureViewRowOrderSpec } from '../TableEnsureViewRowOrderSpec';
import type { TableRemoveFieldSpec } from '../TableRemoveFieldSpec';
import type { TableRemoveViewSpec } from '../TableRemoveViewSpec';
import type { TableRenameSpec } from '../TableRenameSpec';
import type { TableRenameViewSpec } from '../TableRenameViewSpec';
import type { TableUpdateFieldAiConfigSpec } from '../TableUpdateFieldAiConfigSpec';
import type { TableUpdateFieldConstraintsSpec } from '../TableUpdateFieldConstraintsSpec';
import type { TableUpdateFieldDbFieldNameSpec } from '../TableUpdateFieldDbFieldNameSpec';
import type { TableUpdateFieldDescriptionSpec } from '../TableUpdateFieldDescriptionSpec';
import type { TableUpdateFieldHasErrorSpec } from '../TableUpdateFieldHasErrorSpec';
import type { TableUpdateFieldNameSpec } from '../TableUpdateFieldNameSpec';
import type { TableUpdateFieldTypeSpec } from '../TableUpdateFieldTypeSpec';
import type { TableUpdatePropertiesSpec } from '../TableUpdatePropertiesSpec';
import type { TableUpdateViewColumnMetaSpec } from '../TableUpdateViewColumnMetaSpec';
import type { TableUpdateViewDescriptionSpec } from '../TableUpdateViewDescriptionSpec';
import type { TableUpdateViewLockedSpec } from '../TableUpdateViewLockedSpec';
import type { TableUpdateViewOptionsSpec } from '../TableUpdateViewOptionsSpec';
import type { TableUpdateViewOrderSpec } from '../TableUpdateViewOrderSpec';
import type { TableUpdateViewQueryDefaultsSpec } from '../TableUpdateViewQueryDefaultsSpec';
import type { TableUpdateViewShareIdSpec } from '../TableUpdateViewShareIdSpec';
import type { TableUpdateViewShareMetaSpec } from '../TableUpdateViewShareMetaSpec';
import type { TableUpdateViewShareStateSpec } from '../TableUpdateViewShareStateSpec';
import type { TableWithViewIdsSpec } from '../TableWithViewIdsSpec';
import type { TableWithPrimaryFieldSpec } from '../TableWithPrimaryFieldSpec';
import { FieldUpdateSemanticsVisitor } from './FieldUpdateSemanticsVisitor';

/**
 * Stateful visitor that generates domain events from table specifications.
 *
 * This visitor traverses table specs and collects the appropriate domain events
 * for each mutation spec type. Query-only specs (ById, ByName for query, etc.)
 * do not generate events.
 *
 * Usage:
 * ```typescript
 * const visitor = TableSpecEventVisitor.create(table, previousTable);
 * const acceptResult = spec.accept(visitor);
 * if (acceptResult.isOk()) {
 *   const events = visitor.collectedEvents();
 * }
 * ```
 */
export class TableSpecEventVisitor implements ITableSpecVisitor<void> {
  private readonly eventsCollected: IDomainEvent[] = [];
  private readonly fieldUpdateSemanticsVisitor = new FieldUpdateSemanticsVisitor();

  private constructor(
    private readonly table: Table,
    private readonly previousTable: Table
  ) {}

  /**
   * Create a new TableSpecEventVisitor.
   *
   * @param table - The table after mutation (current state)
   * @param previousTable - The table before mutation (for rename events)
   */
  static create(table: Table, previousTable: Table): TableSpecEventVisitor {
    return new TableSpecEventVisitor(table, previousTable);
  }

  /**
   * Returns all events collected during spec traversal.
   */
  collectedEvents(): ReadonlyArray<IDomainEvent> {
    return [...this.eventsCollected];
  }

  visit(_spec: ISpecification<Table, ITableSpecVisitor<void>>): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    const field = spec.field();
    const viewOrdersResult = this.collectViewOrders(field.id());
    if (viewOrdersResult.isErr()) {
      return err<void, DomainError>(viewOrdersResult.error);
    }

    this.eventsCollected.push(
      FieldCreated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: field.id(),
        viewOrders: viewOrdersResult.value,
      })
    );

    return ok(undefined);
  }

  visitTableAddFields(
    spec: TableAddFieldsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    for (const field of spec.fields()) {
      const viewOrdersResult = this.collectViewOrders(field.id());
      if (viewOrdersResult.isErr()) {
        return err<void, DomainError>(viewOrdersResult.error);
      }

      this.eventsCollected.push(
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

  visitTableAddView(spec: TableAddViewSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    this.eventsCollected.push(
      ViewCreated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.view().id(),
      })
    );
    return ok(undefined);
  }

  visitTableEnsureViewRowOrder(
    _spec: TableEnsureViewRowOrderSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRemoveView(
    spec: TableRemoveViewSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const version = spec.view().version();
    this.eventsCollected.push(
      ViewDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.view().id(),
        ...(version.isOk() ? { oldVersion: version.value.toNumber() } : {}),
      })
    );
    return ok(undefined);
  }

  visitTableRenameView(
    spec: TableRenameViewSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      ViewRenamed.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.viewId(),
        previousName: spec.previousName(),
        nextName: spec.nextName(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewDescription(
    spec: TableUpdateViewDescriptionSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      ViewDescriptionUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.viewId(),
        previousDescription: spec.previousDescription(),
        nextDescription: spec.nextDescription(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewLocked(
    spec: TableUpdateViewLockedSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      ViewLockedUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.viewId(),
        previousIsLocked: spec.previousIsLocked(),
        nextIsLocked: spec.nextIsLocked(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewOrder(
    spec: TableUpdateViewOrderSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    for (const change of spec.changes()) {
      this.eventsCollected.push(
        ViewOrderUpdated.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          viewId: change.viewId,
          previousOrder: change.previousOrder,
          nextOrder: change.nextOrder,
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
        return err<Readonly<Record<string, number>>, DomainError>(viewMetaResult.error);
      }
      const order = viewMetaResult.value.toDto()[fieldIdStr]?.order;
      if (typeof order === 'number') {
        viewOrders[view.id().toString()] = order;
      }
    }

    return ok(viewOrders);
  }

  visitTableAddSelectOptions(
    _spec: TableAddSelectOptionsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableDuplicateField(
    _spec: TableDuplicateFieldSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableRemoveField(
    spec: TableRemoveFieldSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const field = spec.field();
    this.eventsCollected.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: field.id(),
      })
    );

    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(
    spec: TableUpdateViewColumnMetaSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const updates = spec.updates();

    for (const update of updates) {
      if (update.changes?.length || update.optionsChanged) {
        const eventFieldId = update.changes?.[0]?.fieldId ?? update.fieldId;
        const metaDto = update.columnMeta.toDto();
        this.eventsCollected.push(
          ViewColumnMetaUpdated.create({
            tableId: this.table.id(),
            baseId: this.table.baseId(),
            viewId: update.viewId,
            fieldId: eventFieldId,
            fieldInColumnMeta: Boolean(metaDto[eventFieldId.toString()]),
            changes: update.changes,
            ...(update.optionsChanged
              ? {
                  optionsChange: {
                    previousOptions: update.previousOptions,
                    nextOptions: update.nextOptions,
                  },
                }
              : {}),
          })
        );
        continue;
      }
      // Get column meta entries to find affected field IDs
      const metaDto = update.columnMeta.toDto();
      for (const fieldIdStr of Object.keys(metaDto)) {
        // Find the field in the table to get proper FieldId
        const field = this.table.getFields().find((f) => f.id().toString() === fieldIdStr);
        if (field) {
          this.eventsCollected.push(
            ViewColumnMetaUpdated.create({
              tableId: this.table.id(),
              baseId: this.table.baseId(),
              viewId: update.viewId,
              fieldId: field.id(),
              fieldInColumnMeta: true,
            })
          );
        }
      }
    }

    return ok(undefined);
  }

  visitTableUpdateViewQueryDefaults(
    spec: TableUpdateViewQueryDefaultsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    for (const update of spec.updates()) {
      const previous = update.previousQueryDefaults?.sourceFilter();
      const next = update.queryDefaults.sourceFilter();
      if (update.previousQueryDefaults && JSON.stringify(previous) !== JSON.stringify(next)) {
        this.eventsCollected.push(
          ViewFilterUpdated.create({
            tableId: this.table.id(),
            baseId: this.table.baseId(),
            viewId: update.viewId,
            previousFilter: previous,
            nextFilter: next,
          })
        );
      }
      if (update.previousQueryDefaults) {
        const previousGroup = viewGroupDtoFromQueryDefaults(update.previousQueryDefaults);
        const nextGroup = viewGroupDtoFromQueryDefaults(update.queryDefaults);
        if (JSON.stringify(previousGroup) !== JSON.stringify(nextGroup)) {
          this.eventsCollected.push(
            ViewGroupUpdated.create({
              tableId: this.table.id(),
              baseId: this.table.baseId(),
              viewId: update.viewId,
              previousGroup,
              nextGroup,
            })
          );
        }
        const previousSort = viewSortDtoFromQueryDefaults(update.previousQueryDefaults);
        const nextSort = viewSortDtoFromQueryDefaults(update.queryDefaults);
        if (JSON.stringify(previousSort) !== JSON.stringify(nextSort)) {
          this.eventsCollected.push(
            ViewSortUpdated.create({
              tableId: this.table.id(),
              baseId: this.table.baseId(),
              viewId: update.viewId,
              previousSort,
              nextSort,
            })
          );
        }
      }
    }
    return ok(undefined);
  }

  visitTableUpdateViewOptions(
    spec: TableUpdateViewOptionsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const update = spec.update();
    this.eventsCollected.push(
      ViewOptionsUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: update.viewId,
        previousOptions: update.previousOptions,
        nextOptions: update.nextOptions,
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewShareMeta(
    spec: TableUpdateViewShareMetaSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      ViewShareMetaUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.viewId(),
        previousShareMeta: spec.previousShareMeta(),
        nextShareMeta: spec.nextShareMeta(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewShareId(
    spec: TableUpdateViewShareIdSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.eventsCollected.push(
      ViewShareIdRefreshed.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        viewId: spec.viewId(),
        previousShareId: spec.previousShareId(),
        nextShareId: spec.nextShareId(),
      })
    );
    return ok(undefined);
  }

  visitTableUpdateViewShareState(
    spec: TableUpdateViewShareStateSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    const nextState = spec.nextState();
    this.eventsCollected.push(
      nextState.enableShare
        ? ViewShareEnabled.create({
            tableId: this.table.id(),
            baseId: this.table.baseId(),
            viewId: spec.viewId(),
            shareId: nextState.shareId,
            shareMeta: nextState.shareMeta,
          })
        : ViewShareDisabled.create({
            tableId: this.table.id(),
            baseId: this.table.baseId(),
            viewId: spec.viewId(),
            previousShareId: spec.previousState().shareId,
            shareMeta: nextState.shareMeta,
          })
    );
    return ok(undefined);
  }

  visitTableRename(spec: TableRenameSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    const previousName = spec.previousName();
    const nextName = spec.nextName();

    if (!previousName.equals(nextName)) {
      this.eventsCollected.push(
        TableRenamed.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          previousName,
          nextName,
        })
      );
    }

    return ok(undefined);
  }

  visitTableUpdateProperties(
    spec: TableUpdatePropertiesSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    if (!spec.previousProperties().equals(spec.nextProperties())) {
      this.eventsCollected.push(
        TablePropertiesUpdated.create({
          tableId: this.table.id(),
          baseId: this.table.baseId(),
          previousProperties: spec.previousProperties(),
          nextProperties: spec.nextProperties(),
        })
      );
    }
    return ok(undefined);
  }

  visitTableByBaseId(_spec: TableByBaseIdSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableById(_spec: TableByIdSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableByViewId(_spec: TableByViewIdSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableWithViewIds(
    _spec: TableWithViewIdsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    // Query-only child hydration spec, no events generated
    return ok(undefined);
  }

  visitTableWithPrimaryField(
    _spec: TableWithPrimaryFieldSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    // Query-only child hydration spec, no events generated
    return ok(undefined);
  }

  visitTableByIncomingReferenceToTable(
    _spec: TableByIncomingReferenceToTableSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableByIds(_spec: TableByIdsSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  visitTableByName(spec: TableByNameSpec<ITableSpecVisitor<void>>): Result<void, DomainError> {
    // Query-only spec, no events generated
    void spec;
    return ok(undefined);
  }

  visitTableByNameLike(
    _spec: TableByNameLikeSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    // Query-only spec, no events generated
    return ok(undefined);
  }

  // Field update specs - generate FieldUpdated events
  visitTableUpdateFieldName(
    spec: TableUpdateFieldNameSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldDbFieldName(
    spec: TableUpdateFieldDbFieldNameSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldType(
    spec: TableUpdateFieldTypeSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.newField().id());
    return ok(undefined);
  }

  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldAiConfig(
    spec: TableUpdateFieldAiConfigSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldDescription(
    spec: TableUpdateFieldDescriptionSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
    this.pushFieldUpdated(spec, spec.fieldId());
    return ok(undefined);
  }

  visitTableUpdateFieldHasError(
    spec: TableUpdateFieldHasErrorSpec<ITableSpecVisitor<void>>
  ): Result<void, DomainError> {
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

  visitUpdateButtonResetCount(spec: UpdateButtonResetCountSpec): Result<void, DomainError> {
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

    this.eventsCollected.push(
      FieldUpdated.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId,
        updatedProperties: semantics.updatedProperties,
        propertySemantics: semantics.propertySemantics,
      })
    );
  }

  // RemoveSymmetricLinkField - generates FieldDeleted event
  visitRemoveSymmetricLinkField(spec: RemoveSymmetricLinkFieldSpec): Result<void, DomainError> {
    this.eventsCollected.push(
      FieldDeleted.create({
        tableId: this.table.id(),
        baseId: this.table.baseId(),
        fieldId: spec.fieldId(),
      })
    );
    return ok(undefined);
  }
}
