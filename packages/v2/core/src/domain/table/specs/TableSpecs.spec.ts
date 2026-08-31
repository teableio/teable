import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../base/BaseId';
import type { ISpecification } from '../../shared/specification/ISpecification';
import { FieldName } from '../fields/FieldName';
import { LinkFieldConfig } from '../fields/types/LinkFieldConfig';
import { Table } from '../Table';
import { TableName } from '../TableName';
import { ViewId } from '../views/ViewId';
import type {
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
  RemoveSymmetricLinkFieldSpec,
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
} from './field-updates';
import type { ITableSpecVisitor } from './ITableSpecVisitor';
import type { TableAddFieldSpec } from './TableAddFieldSpec';
import type { TableAddFieldsSpec } from './TableAddFieldsSpec';
import type { TableAddSelectOptionsSpec } from './TableAddSelectOptionsSpec';
import type { TableAddViewSpec } from './TableAddViewSpec';
import { TableByBaseIdSpec } from './TableByBaseIdSpec';
import { TableByIdSpec } from './TableByIdSpec';
import { TableByIdsSpec } from './TableByIdsSpec';
import { TableByIncomingReferenceToTableSpec } from './TableByIncomingReferenceToTableSpec';
import { TableByNameLikeSpec } from './TableByNameLikeSpec';
import { TableByNameSpec } from './TableByNameSpec';
import { TableByViewIdSpec } from './TableByViewIdSpec';
import type { TableDuplicateFieldSpec } from './TableDuplicateFieldSpec';
import type { TableEnsureViewRowOrderSpec } from './TableEnsureViewRowOrderSpec';
import type { TableRemoveFieldSpec } from './TableRemoveFieldSpec';
import type { TableRemoveViewSpec } from './TableRemoveViewSpec';
import type { TableRenameSpec } from './TableRenameSpec';
import type { TableRenameViewSpec } from './TableRenameViewSpec';
import type { TableUpdateFieldAiConfigSpec } from './TableUpdateFieldAiConfigSpec';
import type { TableUpdateFieldConstraintsSpec } from './TableUpdateFieldConstraintsSpec';
import type { TableUpdateFieldDbFieldNameSpec } from './TableUpdateFieldDbFieldNameSpec';
import type { TableUpdateFieldDescriptionSpec } from './TableUpdateFieldDescriptionSpec';
import type { TableUpdateFieldHasErrorSpec } from './TableUpdateFieldHasErrorSpec';
import type { TableUpdateFieldNameSpec } from './TableUpdateFieldNameSpec';
import type { TableUpdateFieldTypeSpec } from './TableUpdateFieldTypeSpec';
import type { TableUpdatePropertiesSpec } from './TableUpdatePropertiesSpec';
import type { TableUpdateViewColumnMetaSpec } from './TableUpdateViewColumnMetaSpec';
import type { TableUpdateViewDescriptionSpec } from './TableUpdateViewDescriptionSpec';
import type { TableUpdateViewLockedSpec } from './TableUpdateViewLockedSpec';
import type { TableUpdateViewOptionsSpec } from './TableUpdateViewOptionsSpec';
import type { TableUpdateViewOrderSpec } from './TableUpdateViewOrderSpec';
import type { TableUpdateViewQueryDefaultsSpec } from './TableUpdateViewQueryDefaultsSpec';
import type { TableUpdateViewShareIdSpec } from './TableUpdateViewShareIdSpec';
import type { TableUpdateViewShareMetaSpec } from './TableUpdateViewShareMetaSpec';
import type { TableUpdateViewShareStateSpec } from './TableUpdateViewShareStateSpec';
import { TableWithViewIdsSpec } from './TableWithViewIdsSpec';
import { TableWithPrimaryFieldSpec } from './TableWithPrimaryFieldSpec';

class SpyVisitor implements ITableSpecVisitor {
  readonly calls: string[] = [];

  visit(_: ISpecification): ReturnType<ITableSpecVisitor['visit']> {
    return ok(undefined);
  }

  visitTableAddField(_: TableAddFieldSpec): ReturnType<ITableSpecVisitor['visitTableAddField']> {
    this.calls.push('TableAddFieldSpec');
    return ok(undefined);
  }

  visitTableAddFields(_: TableAddFieldsSpec): ReturnType<ITableSpecVisitor['visitTableAddFields']> {
    this.calls.push('TableAddFieldsSpec');
    return ok(undefined);
  }

  visitTableAddView(_: TableAddViewSpec): ReturnType<ITableSpecVisitor['visitTableAddView']> {
    this.calls.push('TableAddViewSpec');
    return ok(undefined);
  }

  visitTableEnsureViewRowOrder(
    _: TableEnsureViewRowOrderSpec
  ): ReturnType<ITableSpecVisitor['visitTableEnsureViewRowOrder']> {
    this.calls.push('TableEnsureViewRowOrderSpec');
    return ok(undefined);
  }

  visitTableRemoveView(
    _: TableRemoveViewSpec
  ): ReturnType<ITableSpecVisitor['visitTableRemoveView']> {
    this.calls.push('TableRemoveViewSpec');
    return ok(undefined);
  }

  visitTableRenameView(
    _: TableRenameViewSpec
  ): ReturnType<ITableSpecVisitor['visitTableRenameView']> {
    this.calls.push('TableRenameViewSpec');
    return ok(undefined);
  }

  visitTableUpdateViewDescription(
    _: TableUpdateViewDescriptionSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewDescription']> {
    this.calls.push('TableUpdateViewDescriptionSpec');
    return ok(undefined);
  }

  visitTableUpdateViewLocked(
    _: TableUpdateViewLockedSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewLocked']> {
    this.calls.push('TableUpdateViewLockedSpec');
    return ok(undefined);
  }

  visitTableUpdateViewOrder(
    _: TableUpdateViewOrderSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewOrder']> {
    this.calls.push('TableUpdateViewOrderSpec');
    return ok(undefined);
  }

  visitTableAddSelectOptions(
    _: TableAddSelectOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitTableAddSelectOptions']> {
    this.calls.push('TableAddSelectOptionsSpec');
    return ok(undefined);
  }

  visitTableDuplicateField(
    _: TableDuplicateFieldSpec
  ): ReturnType<ITableSpecVisitor['visitTableDuplicateField']> {
    this.calls.push('TableDuplicateFieldSpec');
    return ok(undefined);
  }

  visitTableRemoveField(
    _: TableRemoveFieldSpec
  ): ReturnType<ITableSpecVisitor['visitTableRemoveField']> {
    this.calls.push('TableRemoveFieldSpec');
    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(
    _: TableUpdateViewColumnMetaSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewColumnMeta']> {
    this.calls.push('TableUpdateViewColumnMetaSpec');
    return ok(undefined);
  }

  visitTableUpdateViewOptions(
    _: TableUpdateViewOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewOptions']> {
    this.calls.push('TableUpdateViewOptionsSpec');
    return ok(undefined);
  }

  visitTableUpdateViewShareMeta(
    _: TableUpdateViewShareMetaSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewShareMeta']> {
    this.calls.push('TableUpdateViewShareMetaSpec');
    return ok(undefined);
  }

  visitTableUpdateViewShareId(
    _: TableUpdateViewShareIdSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewShareId']> {
    this.calls.push('TableUpdateViewShareIdSpec');
    return ok(undefined);
  }

  visitTableUpdateViewShareState(
    _: TableUpdateViewShareStateSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewShareState']> {
    this.calls.push('TableUpdateViewShareStateSpec');
    return ok(undefined);
  }

  visitTableUpdateViewQueryDefaults(
    _: TableUpdateViewQueryDefaultsSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateViewQueryDefaults']> {
    this.calls.push('TableUpdateViewQueryDefaultsSpec');
    return ok(undefined);
  }

  visitTableByBaseId(_: TableByBaseIdSpec): ReturnType<ITableSpecVisitor['visitTableByBaseId']> {
    this.calls.push('TableByBaseIdSpec');
    return ok(undefined);
  }

  visitTableById(_: TableByIdSpec): ReturnType<ITableSpecVisitor['visitTableById']> {
    this.calls.push('TableByIdSpec');
    return ok(undefined);
  }

  visitTableByViewId(_: TableByViewIdSpec): ReturnType<ITableSpecVisitor['visitTableByViewId']> {
    this.calls.push('TableByViewIdSpec');
    return ok(undefined);
  }

  visitTableWithViewIds(
    _: TableWithViewIdsSpec
  ): ReturnType<ITableSpecVisitor['visitTableWithViewIds']> {
    this.calls.push('TableWithViewIdsSpec');
    return ok(undefined);
  }

  visitTableWithPrimaryField(
    _: TableWithPrimaryFieldSpec
  ): ReturnType<ITableSpecVisitor['visitTableWithPrimaryField']> {
    this.calls.push('TableWithPrimaryFieldSpec');
    return ok(undefined);
  }

  visitTableByIncomingReferenceToTable(
    _: TableByIncomingReferenceToTableSpec
  ): ReturnType<ITableSpecVisitor['visitTableByIncomingReferenceToTable']> {
    this.calls.push('TableByIncomingReferenceToTableSpec');
    return ok(undefined);
  }

  visitTableByIds(_: TableByIdsSpec): ReturnType<ITableSpecVisitor['visitTableByIds']> {
    this.calls.push('TableByIdsSpec');
    return ok(undefined);
  }

  visitTableByName(_: TableByNameSpec): ReturnType<ITableSpecVisitor['visitTableByName']> {
    this.calls.push('TableByNameSpec');
    return ok(undefined);
  }

  visitTableByNameLike(
    _: TableByNameLikeSpec
  ): ReturnType<ITableSpecVisitor['visitTableByNameLike']> {
    this.calls.push('TableByNameLikeSpec');
    return ok(undefined);
  }

  visitTableRename(_: TableRenameSpec): ReturnType<ITableSpecVisitor['visitTableRename']> {
    this.calls.push('TableRenameSpec');
    return ok(undefined);
  }

  visitTableUpdateProperties(
    _: TableUpdatePropertiesSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateProperties']> {
    this.calls.push('TableUpdatePropertiesSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldName(
    _: TableUpdateFieldNameSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldName']> {
    this.calls.push('TableUpdateFieldNameSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldDbFieldName(
    _: TableUpdateFieldDbFieldNameSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldDbFieldName']> {
    this.calls.push('TableUpdateFieldDbFieldNameSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldType(
    _: TableUpdateFieldTypeSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldType']> {
    this.calls.push('TableUpdateFieldTypeSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldConstraints(
    _: TableUpdateFieldConstraintsSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldConstraints']> {
    this.calls.push('TableUpdateFieldConstraintsSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldAiConfig(
    _: TableUpdateFieldAiConfigSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldAiConfig']> {
    this.calls.push('TableUpdateFieldAiConfigSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldDescription(
    _: TableUpdateFieldDescriptionSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldDescription']> {
    this.calls.push('TableUpdateFieldDescriptionSpec');
    return ok(undefined);
  }

  visitTableUpdateFieldHasError(
    _: TableUpdateFieldHasErrorSpec
  ): ReturnType<ITableSpecVisitor['visitTableUpdateFieldHasError']> {
    this.calls.push('TableUpdateFieldHasErrorSpec');
    return ok(undefined);
  }

  // ============ Field-type-specific update specs ============

  // SingleLineText
  visitUpdateSingleLineTextShowAs(
    _: UpdateSingleLineTextShowAsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateSingleLineTextShowAs']> {
    this.calls.push('UpdateSingleLineTextShowAsSpec');
    return ok(undefined);
  }

  visitUpdateSingleLineTextDefaultValue(
    _: UpdateSingleLineTextDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateSingleLineTextDefaultValue']> {
    this.calls.push('UpdateSingleLineTextDefaultValueSpec');
    return ok(undefined);
  }

  // LongText
  visitUpdateLongTextShowAs(
    _: UpdateLongTextShowAsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateLongTextShowAs']> {
    this.calls.push('UpdateLongTextShowAsSpec');
    return ok(undefined);
  }

  visitUpdateLongTextDefaultValue(
    _: UpdateLongTextDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateLongTextDefaultValue']> {
    this.calls.push('UpdateLongTextDefaultValueSpec');
    return ok(undefined);
  }

  // Number
  visitUpdateNumberFormatting(
    _: UpdateNumberFormattingSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateNumberFormatting']> {
    this.calls.push('UpdateNumberFormattingSpec');
    return ok(undefined);
  }

  visitUpdateNumberShowAs(
    _: UpdateNumberShowAsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateNumberShowAs']> {
    this.calls.push('UpdateNumberShowAsSpec');
    return ok(undefined);
  }

  visitUpdateNumberDefaultValue(
    _: UpdateNumberDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateNumberDefaultValue']> {
    this.calls.push('UpdateNumberDefaultValueSpec');
    return ok(undefined);
  }

  // Date
  visitUpdateDateFormatting(
    _: UpdateDateFormattingSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateDateFormatting']> {
    this.calls.push('UpdateDateFormattingSpec');
    return ok(undefined);
  }

  visitUpdateDateDefaultValue(
    _: UpdateDateDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateDateDefaultValue']> {
    this.calls.push('UpdateDateDefaultValueSpec');
    return ok(undefined);
  }

  // Checkbox
  visitUpdateCheckboxDefaultValue(
    _: UpdateCheckboxDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateCheckboxDefaultValue']> {
    this.calls.push('UpdateCheckboxDefaultValueSpec');
    return ok(undefined);
  }

  // Rating
  visitUpdateRatingMax(
    _: UpdateRatingMaxSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRatingMax']> {
    this.calls.push('UpdateRatingMaxSpec');
    return ok(undefined);
  }

  visitUpdateRatingIcon(
    _: UpdateRatingIconSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRatingIcon']> {
    this.calls.push('UpdateRatingIconSpec');
    return ok(undefined);
  }

  visitUpdateRatingColor(
    _: UpdateRatingColorSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRatingColor']> {
    this.calls.push('UpdateRatingColorSpec');
    return ok(undefined);
  }

  // User
  visitUpdateUserMultiplicity(
    _: UpdateUserMultiplicitySpec
  ): ReturnType<ITableSpecVisitor['visitUpdateUserMultiplicity']> {
    this.calls.push('UpdateUserMultiplicitySpec');
    return ok(undefined);
  }

  visitUpdateUserNotification(
    _: UpdateUserNotificationSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateUserNotification']> {
    this.calls.push('UpdateUserNotificationSpec');
    return ok(undefined);
  }

  visitUpdateUserDefaultValue(
    _: UpdateUserDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateUserDefaultValue']> {
    this.calls.push('UpdateUserDefaultValueSpec');
    return ok(undefined);
  }

  // Button
  visitUpdateButtonLabel(
    _: UpdateButtonLabelSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateButtonLabel']> {
    this.calls.push('UpdateButtonLabelSpec');
    return ok(undefined);
  }

  visitUpdateButtonColor(
    _: UpdateButtonColorSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateButtonColor']> {
    this.calls.push('UpdateButtonColorSpec');
    return ok(undefined);
  }

  visitUpdateButtonMaxCount(
    _: UpdateButtonMaxCountSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateButtonMaxCount']> {
    this.calls.push('UpdateButtonMaxCountSpec');
    return ok(undefined);
  }

  visitUpdateButtonResetCount(
    _: UpdateButtonResetCountSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateButtonResetCount']> {
    this.calls.push('UpdateButtonResetCountSpec');
    return ok(undefined);
  }

  visitUpdateButtonWorkflow(
    _: UpdateButtonWorkflowSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateButtonWorkflow']> {
    this.calls.push('UpdateButtonWorkflowSpec');
    return ok(undefined);
  }

  // SingleSelect
  visitUpdateSingleSelectOptions(
    _: UpdateSingleSelectOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateSingleSelectOptions']> {
    this.calls.push('UpdateSingleSelectOptionsSpec');
    return ok(undefined);
  }

  visitUpdateSingleSelectDefaultValue(
    _: UpdateSingleSelectDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateSingleSelectDefaultValue']> {
    this.calls.push('UpdateSingleSelectDefaultValueSpec');
    return ok(undefined);
  }

  visitUpdateSingleSelectAutoNewOptions(
    _: UpdateSingleSelectAutoNewOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateSingleSelectAutoNewOptions']> {
    this.calls.push('UpdateSingleSelectAutoNewOptionsSpec');
    return ok(undefined);
  }

  // MultipleSelect
  visitUpdateMultipleSelectOptions(
    _: UpdateMultipleSelectOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateMultipleSelectOptions']> {
    this.calls.push('UpdateMultipleSelectOptionsSpec');
    return ok(undefined);
  }

  visitUpdateMultipleSelectDefaultValue(
    _: UpdateMultipleSelectDefaultValueSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateMultipleSelectDefaultValue']> {
    this.calls.push('UpdateMultipleSelectDefaultValueSpec');
    return ok(undefined);
  }

  visitUpdateMultipleSelectAutoNewOptions(
    _: UpdateMultipleSelectAutoNewOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateMultipleSelectAutoNewOptions']> {
    this.calls.push('UpdateMultipleSelectAutoNewOptionsSpec');
    return ok(undefined);
  }

  // Formula
  visitUpdateFormulaExpression(
    _: UpdateFormulaExpressionSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateFormulaExpression']> {
    this.calls.push('UpdateFormulaExpressionSpec');
    return ok(undefined);
  }

  visitUpdateFormulaFormatting(
    _: UpdateFormulaFormattingSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateFormulaFormatting']> {
    this.calls.push('UpdateFormulaFormattingSpec');
    return ok(undefined);
  }

  visitUpdateFormulaShowAs(
    _: UpdateFormulaShowAsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateFormulaShowAs']> {
    this.calls.push('UpdateFormulaShowAsSpec');
    return ok(undefined);
  }

  visitUpdateFormulaTimeZone(
    _: UpdateFormulaTimeZoneSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateFormulaTimeZone']> {
    this.calls.push('UpdateFormulaTimeZoneSpec');
    return ok(undefined);
  }

  // Link
  visitUpdateLinkConfig(
    _: UpdateLinkConfigSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateLinkConfig']> {
    this.calls.push('UpdateLinkConfigSpec');
    return ok(undefined);
  }

  visitUpdateLinkRelationship(
    _: UpdateLinkRelationshipSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateLinkRelationship']> {
    this.calls.push('UpdateLinkRelationshipSpec');
    return ok(undefined);
  }

  visitRemoveSymmetricLinkField(
    _: RemoveSymmetricLinkFieldSpec
  ): ReturnType<ITableSpecVisitor['visitRemoveSymmetricLinkField']> {
    this.calls.push('RemoveSymmetricLinkFieldSpec');
    return ok(undefined);
  }

  // Lookup
  visitUpdateLookupOptions(
    _: UpdateLookupOptionsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateLookupOptions']> {
    this.calls.push('UpdateLookupOptionsSpec');
    return ok(undefined);
  }

  // Rollup
  visitUpdateRollupConfig(
    _: UpdateRollupConfigSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRollupConfig']> {
    this.calls.push('UpdateRollupConfigSpec');
    return ok(undefined);
  }

  visitUpdateRollupExpression(
    _: UpdateRollupExpressionSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRollupExpression']> {
    this.calls.push('UpdateRollupExpressionSpec');
    return ok(undefined);
  }

  visitUpdateRollupFormatting(
    _: UpdateRollupFormattingSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRollupFormatting']> {
    this.calls.push('UpdateRollupFormattingSpec');
    return ok(undefined);
  }

  visitUpdateRollupShowAs(
    _: UpdateRollupShowAsSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRollupShowAs']> {
    this.calls.push('UpdateRollupShowAsSpec');
    return ok(undefined);
  }

  visitUpdateRollupTimeZone(
    _: UpdateRollupTimeZoneSpec
  ): ReturnType<ITableSpecVisitor['visitUpdateRollupTimeZone']> {
    this.calls.push('UpdateRollupTimeZoneSpec');
    return ok(undefined);
  }
}

const buildTable = (baseId: BaseId, name: TableName) => {
  const fieldNameResult = FieldName.create('Title');
  fieldNameResult._unsafeUnwrap();
  undefined;
  const builder = Table.builder().withBaseId(baseId).withName(name);
  builder.field().singleLineText().withName(fieldNameResult._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  const tableResult = builder.build();
  tableResult._unsafeUnwrap();
  undefined;
  return tableResult._unsafeUnwrap();
};

const buildHostTableReferencing = (hostBaseId: BaseId, foreignTable: Table, name: TableName) => {
  const hostNameField = FieldName.create('Host Title')._unsafeUnwrap();
  const linkFieldName = FieldName.create('Foreign Link')._unsafeUnwrap();
  const linkConfig = LinkFieldConfig.create({
    baseId: foreignTable.baseId().toString(),
    relationship: 'manyMany',
    foreignTableId: foreignTable.id().toString(),
    lookupFieldId: foreignTable.primaryFieldId().toString(),
    isOneWay: true,
  })._unsafeUnwrap();

  const builder = Table.builder().withBaseId(hostBaseId).withName(name);
  builder.field().singleLineText().withName(hostNameField).primary().done();
  builder.field().link().withName(linkFieldName).withConfig(linkConfig).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('Table specs', () => {
  it('evaluates base id spec', () => {
    const baseIdResult = BaseId.create(`bse${'a'.repeat(16)}`);
    const otherBaseIdResult = BaseId.create(`bse${'b'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    [baseIdResult, otherBaseIdResult, nameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    otherBaseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    if (!table) return;

    const spec = TableByBaseIdSpec.create(baseIdResult._unsafeUnwrap());
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(
      spec.isSatisfiedBy(
        buildTable(otherBaseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap()) ?? table
      )
    ).toBe(false);
    const mutateResult = spec.mutate(table);
    mutateResult._unsafeUnwrap();
    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByBaseIdSpec');
  });

  it('evaluates id and name specs', () => {
    const baseIdResult = BaseId.create(`bse${'c'.repeat(16)}`);
    const nameResult = TableName.create('Tasks');
    const otherNameResult = TableName.create('Other');
    [baseIdResult, nameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    if (!table) return;

    const byId = TableByIdSpec.create(table.id());
    expect(byId.isSatisfiedBy(table)).toBe(true);
    const byIds = TableByIdsSpec.create([table.id()]);
    expect(byIds.isSatisfiedBy(table)).toBe(true);
    const byName = TableByNameSpec.create(nameResult._unsafeUnwrap());
    expect(byName.isSatisfiedBy(table)).toBe(true);
    const byOtherName = TableByNameSpec.create(otherNameResult._unsafeUnwrap());
    expect(byOtherName.isSatisfiedBy(table)).toBe(false);

    const mutateResult = byOtherName.mutate(table);
    mutateResult._unsafeUnwrap();

    expect(mutateResult._unsafeUnwrap().name().toString()).toBe(
      otherNameResult._unsafeUnwrap().toString()
    );
    expect(table.name().toString()).toBe(nameResult._unsafeUnwrap().toString());

    const visitor = new SpyVisitor();
    byId.accept(visitor)._unsafeUnwrap();
    byIds.accept(visitor)._unsafeUnwrap();
    byName.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByIdSpec');
    expect(visitor.calls).toContain('TableByIdsSpec');
    expect(visitor.calls).toContain('TableByNameSpec');
  });

  it('selects a Table by a child View without changing aggregate ownership', () => {
    const table = buildTable(
      BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap(),
      TableName.create('Views')._unsafeUnwrap()
    );
    const view = table.views()[0];
    const spec = TableByViewIdSpec.create(view.id());
    const missingSpec = TableByViewIdSpec.create(
      ViewId.create(`viw${'z'.repeat(16)}`)._unsafeUnwrap()
    );

    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(missingSpec.isSatisfiedBy(table)).toBe(false);
    expect(spec.mutate(table)._unsafeUnwrap()).toBe(table);

    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByViewIdSpec');
  });

  it('selects a View hydration subset without changing aggregate identity', () => {
    const table = buildTable(
      BaseId.create(`bse${'v'.repeat(16)}`)._unsafeUnwrap(),
      TableName.create('Projected views')._unsafeUnwrap()
    );
    const spec = TableWithViewIdsSpec.create([table.views()[0].id()]);

    expect(spec.viewIds()).toEqual([table.views()[0].id()]);
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(spec.mutate(table)._unsafeUnwrap()).toBe(table);

    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableWithViewIdsSpec');
  });

  it('narrows Field hydration to the primary Field without changing the Table match', () => {
    const table = buildTable(
      BaseId.create(`bse${'p'.repeat(16)}`)._unsafeUnwrap(),
      TableName.create('Primary projection')._unsafeUnwrap()
    );
    const spec = TableWithPrimaryFieldSpec.create();

    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(spec.mutate(table)._unsafeUnwrap()).toBe(table);

    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableWithPrimaryFieldSpec');
  });

  it('evaluates name like specs', () => {
    const baseIdResult = BaseId.create(`bse${'e'.repeat(16)}`);
    const nameResult = TableName.create('Projects');
    const queryNameResult = TableName.create('Pro');
    const otherNameResult = TableName.create('Tasks');
    [baseIdResult, nameResult, queryNameResult, otherNameResult].forEach((r) => r._unsafeUnwrap());
    baseIdResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    queryNameResult._unsafeUnwrap();
    otherNameResult._unsafeUnwrap();

    const table = buildTable(baseIdResult._unsafeUnwrap(), nameResult._unsafeUnwrap());
    const otherTable = buildTable(baseIdResult._unsafeUnwrap(), otherNameResult._unsafeUnwrap());
    if (!table || !otherTable) return;

    const spec = TableByNameLikeSpec.create(queryNameResult._unsafeUnwrap());
    expect(spec.isSatisfiedBy(table)).toBe(true);
    expect(spec.isSatisfiedBy(otherTable)).toBe(false);

    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByNameLikeSpec');
  });

  it('evaluates incoming-reference specs', () => {
    const foreignBaseId = BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap();
    const hostBaseId = BaseId.create(`bse${'g'.repeat(16)}`)._unsafeUnwrap();
    const foreignName = TableName.create('Foreign')._unsafeUnwrap();
    const hostName = TableName.create('Host')._unsafeUnwrap();
    const unrelatedName = TableName.create('Other')._unsafeUnwrap();

    const foreignTable = buildTable(foreignBaseId, foreignName);
    const hostTable = buildHostTableReferencing(hostBaseId, foreignTable, hostName);
    const unrelatedTable = buildTable(hostBaseId, unrelatedName);

    const spec = TableByIncomingReferenceToTableSpec.create(foreignTable.id());
    expect(spec.isSatisfiedBy(foreignTable)).toBe(false);
    expect(spec.isSatisfiedBy(hostTable)).toBe(true);
    expect(spec.isSatisfiedBy(unrelatedTable)).toBe(false);

    const visitor = new SpyVisitor();
    spec.accept(visitor)._unsafeUnwrap();
    expect(visitor.calls).toContain('TableByIncomingReferenceToTableSpec');
  });
});
