import type { FieldUpdatedPropertySemantics } from '../../events/FieldUpdated';
import {
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
import { TableUpdateFieldAiConfigSpec } from '../TableUpdateFieldAiConfigSpec';
import { TableUpdateFieldConstraintsSpec } from '../TableUpdateFieldConstraintsSpec';
import { TableUpdateFieldDbFieldNameSpec } from '../TableUpdateFieldDbFieldNameSpec';
import { TableUpdateFieldDescriptionSpec } from '../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldHasErrorSpec } from '../TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldNameSpec } from '../TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../TableUpdateFieldTypeSpec';

export type FieldUpdateSpecSemantics = {
  readonly updatedProperties: ReadonlyArray<string>;
  readonly propertySemantics: Readonly<Record<string, FieldUpdatedPropertySemantics>>;
};

const topLevelProperty = (
  property: string,
  mayRequirePresence = false
): FieldUpdatedPropertySemantics => ({
  realtimePath: [property],
  presencePath: [property],
  mayRequirePresence,
});

const optionsRootProperty = (): FieldUpdatedPropertySemantics => ({
  realtimePath: ['options'],
  presencePath: ['options'],
  mayRequirePresence: true,
});

const optionBackedProperty = (presenceKey: string): FieldUpdatedPropertySemantics => ({
  realtimePath: ['options'],
  presencePath: ['options', presenceKey],
  mayRequirePresence: true,
});

const buildSemantics = (
  entries: ReadonlyArray<readonly [string, FieldUpdatedPropertySemantics]>
): FieldUpdateSpecSemantics | undefined => {
  if (entries.length === 0) {
    return undefined;
  }

  return {
    updatedProperties: entries.map(([property]) => property),
    propertySemantics: Object.fromEntries(entries),
  };
};

export class FieldUpdateSemanticsVisitor {
  /**
   * Table specs erase visitor return values in `accept()`, so this classifier
   * dispatches directly on the concrete spec type to recover field-update semantics.
   */
  visit(spec: object): FieldUpdateSpecSemantics | undefined {
    if (spec instanceof TableUpdateFieldNameSpec) return this.visitTableUpdateFieldName(spec);
    if (spec instanceof TableUpdateFieldDbFieldNameSpec)
      return this.visitTableUpdateFieldDbFieldName(spec);
    if (spec instanceof TableUpdateFieldTypeSpec) return this.visitTableUpdateFieldType(spec);
    if (spec instanceof TableUpdateFieldConstraintsSpec)
      return this.visitTableUpdateFieldConstraints(spec);
    if (spec instanceof TableUpdateFieldAiConfigSpec)
      return this.visitTableUpdateFieldAiConfig(spec);
    if (spec instanceof TableUpdateFieldDescriptionSpec)
      return this.visitTableUpdateFieldDescription(spec);
    if (spec instanceof TableUpdateFieldHasErrorSpec)
      return this.visitTableUpdateFieldHasError(spec);
    if (spec instanceof UpdateSingleLineTextShowAsSpec)
      return this.visitUpdateSingleLineTextShowAs(spec);
    if (spec instanceof UpdateSingleLineTextDefaultValueSpec)
      return this.visitUpdateSingleLineTextDefaultValue(spec);
    if (spec instanceof UpdateLongTextShowAsSpec) return this.visitUpdateLongTextShowAs(spec);
    if (spec instanceof UpdateLongTextDefaultValueSpec)
      return this.visitUpdateLongTextDefaultValue(spec);
    if (spec instanceof UpdateNumberFormattingSpec) return this.visitUpdateNumberFormatting(spec);
    if (spec instanceof UpdateNumberShowAsSpec) return this.visitUpdateNumberShowAs(spec);
    if (spec instanceof UpdateNumberDefaultValueSpec)
      return this.visitUpdateNumberDefaultValue(spec);
    if (spec instanceof UpdateDateFormattingSpec) return this.visitUpdateDateFormatting(spec);
    if (spec instanceof UpdateDateDefaultValueSpec) return this.visitUpdateDateDefaultValue(spec);
    if (spec instanceof UpdateCheckboxDefaultValueSpec)
      return this.visitUpdateCheckboxDefaultValue(spec);
    if (spec instanceof UpdateRatingMaxSpec) return this.visitUpdateRatingMax(spec);
    if (spec instanceof UpdateRatingIconSpec) return this.visitUpdateRatingIcon(spec);
    if (spec instanceof UpdateRatingColorSpec) return this.visitUpdateRatingColor(spec);
    if (spec instanceof UpdateUserMultiplicitySpec) return this.visitUpdateUserMultiplicity(spec);
    if (spec instanceof UpdateUserNotificationSpec) return this.visitUpdateUserNotification(spec);
    if (spec instanceof UpdateUserDefaultValueSpec) return this.visitUpdateUserDefaultValue(spec);
    if (spec instanceof UpdateButtonLabelSpec) return this.visitUpdateButtonLabel(spec);
    if (spec instanceof UpdateButtonColorSpec) return this.visitUpdateButtonColor(spec);
    if (spec instanceof UpdateButtonMaxCountSpec) return this.visitUpdateButtonMaxCount(spec);
    if (spec instanceof UpdateButtonWorkflowSpec) return this.visitUpdateButtonWorkflow(spec);
    if (spec instanceof UpdateSingleSelectOptionsSpec)
      return this.visitUpdateSingleSelectOptions(spec);
    if (spec instanceof UpdateSingleSelectDefaultValueSpec)
      return this.visitUpdateSingleSelectDefaultValue(spec);
    if (spec instanceof UpdateSingleSelectAutoNewOptionsSpec)
      return this.visitUpdateSingleSelectAutoNewOptions(spec);
    if (spec instanceof UpdateMultipleSelectOptionsSpec)
      return this.visitUpdateMultipleSelectOptions(spec);
    if (spec instanceof UpdateMultipleSelectDefaultValueSpec)
      return this.visitUpdateMultipleSelectDefaultValue(spec);
    if (spec instanceof UpdateMultipleSelectAutoNewOptionsSpec)
      return this.visitUpdateMultipleSelectAutoNewOptions(spec);
    if (spec instanceof UpdateFormulaExpressionSpec) return this.visitUpdateFormulaExpression(spec);
    if (spec instanceof UpdateFormulaFormattingSpec) return this.visitUpdateFormulaFormatting(spec);
    if (spec instanceof UpdateFormulaShowAsSpec) return this.visitUpdateFormulaShowAs(spec);
    if (spec instanceof UpdateFormulaTimeZoneSpec) return this.visitUpdateFormulaTimeZone(spec);
    if (spec instanceof UpdateLinkConfigSpec) return this.visitUpdateLinkConfig(spec);
    if (spec instanceof UpdateLinkRelationshipSpec) return this.visitUpdateLinkRelationship(spec);
    if (spec instanceof UpdateLookupOptionsSpec) return this.visitUpdateLookupOptions(spec);
    if (spec instanceof UpdateRollupConfigSpec) return this.visitUpdateRollupConfig(spec);
    if (spec instanceof UpdateRollupExpressionSpec) return this.visitUpdateRollupExpression(spec);
    if (spec instanceof UpdateRollupFormattingSpec) return this.visitUpdateRollupFormatting(spec);
    if (spec instanceof UpdateRollupShowAsSpec) return this.visitUpdateRollupShowAs(spec);
    if (spec instanceof UpdateRollupTimeZoneSpec) return this.visitUpdateRollupTimeZone(spec);
    if (spec instanceof RemoveSymmetricLinkFieldSpec) return undefined;

    return undefined;
  }

  visitTableUpdateFieldName(_spec: TableUpdateFieldNameSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['name', topLevelProperty('name')]])!;
  }

  visitTableUpdateFieldDbFieldName(
    _spec: TableUpdateFieldDbFieldNameSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['dbFieldName', topLevelProperty('dbFieldName')]])!;
  }

  visitTableUpdateFieldType(_spec: TableUpdateFieldTypeSpec): FieldUpdateSpecSemantics {
    return buildSemantics([
      ['type', topLevelProperty('type', true)],
      ['options', optionsRootProperty()],
    ])!;
  }

  visitTableUpdateFieldConstraints(
    spec: TableUpdateFieldConstraintsSpec
  ): FieldUpdateSpecSemantics | undefined {
    return buildSemantics([
      ...(!spec.previousNotNull().equals(spec.nextNotNull())
        ? ([['notNull', topLevelProperty('notNull')]] as const)
        : []),
      ...(!spec.previousUnique().equals(spec.nextUnique())
        ? ([['unique', topLevelProperty('unique')]] as const)
        : []),
    ]);
  }

  visitTableUpdateFieldAiConfig(_spec: TableUpdateFieldAiConfigSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['aiConfig', topLevelProperty('aiConfig')]])!;
  }

  visitTableUpdateFieldDescription(
    _spec: TableUpdateFieldDescriptionSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['description', topLevelProperty('description')]])!;
  }

  visitTableUpdateFieldHasError(_spec: TableUpdateFieldHasErrorSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['hasError', topLevelProperty('hasError')]])!;
  }

  visitUpdateSingleLineTextShowAs(_spec: UpdateSingleLineTextShowAsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['showAs', optionBackedProperty('showAs')]])!;
  }

  visitUpdateSingleLineTextDefaultValue(
    _spec: UpdateSingleLineTextDefaultValueSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateLongTextShowAs(_spec: UpdateLongTextShowAsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['showAs', optionBackedProperty('showAs')]])!;
  }

  visitUpdateLongTextDefaultValue(_spec: UpdateLongTextDefaultValueSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateNumberFormatting(_spec: UpdateNumberFormattingSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['formatting', optionBackedProperty('formatting')]])!;
  }

  visitUpdateNumberShowAs(_spec: UpdateNumberShowAsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['showAs', optionBackedProperty('showAs')]])!;
  }

  visitUpdateNumberDefaultValue(_spec: UpdateNumberDefaultValueSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateDateFormatting(_spec: UpdateDateFormattingSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['formatting', optionBackedProperty('formatting')]])!;
  }

  visitUpdateDateDefaultValue(_spec: UpdateDateDefaultValueSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateCheckboxDefaultValue(_spec: UpdateCheckboxDefaultValueSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateRatingMax(_spec: UpdateRatingMaxSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['max', optionBackedProperty('max')]])!;
  }

  visitUpdateRatingIcon(_spec: UpdateRatingIconSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['icon', optionBackedProperty('icon')]])!;
  }

  visitUpdateRatingColor(_spec: UpdateRatingColorSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['color', optionBackedProperty('color')]])!;
  }

  visitUpdateUserMultiplicity(_spec: UpdateUserMultiplicitySpec): FieldUpdateSpecSemantics {
    return buildSemantics([['isMultiple', optionBackedProperty('isMultiple')]])!;
  }

  visitUpdateUserNotification(_spec: UpdateUserNotificationSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['shouldNotify', optionBackedProperty('shouldNotify')]])!;
  }

  visitUpdateUserDefaultValue(_spec: UpdateUserDefaultValueSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateButtonLabel(_spec: UpdateButtonLabelSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['label', optionBackedProperty('label')]])!;
  }

  visitUpdateButtonColor(_spec: UpdateButtonColorSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['color', optionBackedProperty('color')]])!;
  }

  visitUpdateButtonMaxCount(_spec: UpdateButtonMaxCountSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['maxCount', optionBackedProperty('maxCount')]])!;
  }

  visitUpdateButtonWorkflow(_spec: UpdateButtonWorkflowSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['workflow', optionBackedProperty('workflow')]])!;
  }

  visitUpdateSingleSelectOptions(_spec: UpdateSingleSelectOptionsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['options', optionsRootProperty()]])!;
  }

  visitUpdateSingleSelectDefaultValue(
    _spec: UpdateSingleSelectDefaultValueSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateSingleSelectAutoNewOptions(
    _spec: UpdateSingleSelectAutoNewOptionsSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['autoNewOptions', optionBackedProperty('preventAutoNewOptions')]])!;
  }

  visitUpdateMultipleSelectOptions(
    _spec: UpdateMultipleSelectOptionsSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['options', optionsRootProperty()]])!;
  }

  visitUpdateMultipleSelectDefaultValue(
    _spec: UpdateMultipleSelectDefaultValueSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['defaultValue', optionBackedProperty('defaultValue')]])!;
  }

  visitUpdateMultipleSelectAutoNewOptions(
    _spec: UpdateMultipleSelectAutoNewOptionsSpec
  ): FieldUpdateSpecSemantics {
    return buildSemantics([['autoNewOptions', optionBackedProperty('preventAutoNewOptions')]])!;
  }

  visitUpdateFormulaExpression(_spec: UpdateFormulaExpressionSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['expression', optionBackedProperty('expression')]])!;
  }

  visitUpdateFormulaFormatting(_spec: UpdateFormulaFormattingSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['formatting', optionBackedProperty('formatting')]])!;
  }

  visitUpdateFormulaShowAs(_spec: UpdateFormulaShowAsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['showAs', optionBackedProperty('showAs')]])!;
  }

  visitUpdateFormulaTimeZone(_spec: UpdateFormulaTimeZoneSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['timeZone', optionBackedProperty('timeZone')]])!;
  }

  visitUpdateLinkConfig(_spec: UpdateLinkConfigSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['linkConfig', optionsRootProperty()]])!;
  }

  visitUpdateLinkRelationship(spec: UpdateLinkRelationshipSpec): FieldUpdateSpecSemantics {
    return buildSemantics([
      ['linkRelationship', optionsRootProperty()],
      ...(spec.isRelationshipTypeChanging()
        ? ([['relationship', optionBackedProperty('relationship')]] as const)
        : []),
      ...(spec.isOneWayChanging()
        ? ([['isOneWay', optionBackedProperty('isOneWay')]] as const)
        : []),
    ])!;
  }

  visitUpdateLookupOptions(_spec: UpdateLookupOptionsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['lookupOptions', topLevelProperty('lookupOptions', true)]])!;
  }

  visitUpdateRollupConfig(_spec: UpdateRollupConfigSpec): FieldUpdateSpecSemantics {
    return buildSemantics([
      [
        'rollupConfig',
        {
          realtimePath: ['config'],
          presencePath: ['config'],
          mayRequirePresence: true,
        },
      ],
    ])!;
  }

  visitUpdateRollupExpression(_spec: UpdateRollupExpressionSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['expression', optionBackedProperty('expression')]])!;
  }

  visitUpdateRollupFormatting(_spec: UpdateRollupFormattingSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['formatting', optionBackedProperty('formatting')]])!;
  }

  visitUpdateRollupShowAs(_spec: UpdateRollupShowAsSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['showAs', optionBackedProperty('showAs')]])!;
  }

  visitUpdateRollupTimeZone(_spec: UpdateRollupTimeZoneSpec): FieldUpdateSpecSemantics {
    return buildSemantics([['timeZone', optionBackedProperty('timeZone')]])!;
  }
}
