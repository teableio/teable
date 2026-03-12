import { describe, expect, it } from 'vitest';

import type { FieldUpdatedPropertySemantics } from '../../../events/FieldUpdated';
import * as FieldUpdateSpecs from '../../field-updates';
import { TableUpdateFieldAiConfigSpec } from '../../TableUpdateFieldAiConfigSpec';
import { TableUpdateFieldConstraintsSpec } from '../../TableUpdateFieldConstraintsSpec';
import { TableUpdateFieldDbFieldNameSpec } from '../../TableUpdateFieldDbFieldNameSpec';
import { TableUpdateFieldDescriptionSpec } from '../../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldHasErrorSpec } from '../../TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldNameSpec } from '../../TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../../TableUpdateFieldTypeSpec';
import { FieldUpdateSemanticsVisitor } from '../FieldUpdateSemanticsVisitor';

type FieldUpdateSpecSemantics = {
  readonly updatedProperties: ReadonlyArray<string>;
  readonly propertySemantics: Readonly<Record<string, FieldUpdatedPropertySemantics>>;
};

type PrototypeCtor<T extends object> = {
  prototype: T;
};

const protoInstance = <T extends object>(
  ctor: PrototypeCtor<T>,
  overrides: Record<string, unknown> = {}
): T => Object.assign(Object.create(ctor.prototype) as T, overrides as Partial<T>);

const topLevel = (property: string, mayRequirePresence = false): FieldUpdatedPropertySemantics => ({
  realtimePath: [property],
  presencePath: [property],
  mayRequirePresence,
});

const optionsRoot = (): FieldUpdatedPropertySemantics => ({
  realtimePath: ['options'],
  presencePath: ['options'],
  mayRequirePresence: true,
});

const optionBacked = (property: string): FieldUpdatedPropertySemantics => ({
  realtimePath: ['options'],
  presencePath: ['options', property],
  mayRequirePresence: true,
});

const rollupConfig = (): FieldUpdatedPropertySemantics => ({
  realtimePath: ['config'],
  presencePath: ['config'],
  mayRequirePresence: true,
});

const semantics = (
  entries: ReadonlyArray<readonly [string, FieldUpdatedPropertySemantics]>
): FieldUpdateSpecSemantics => ({
  updatedProperties: entries.map(([property]) => property),
  propertySemantics: Object.fromEntries(entries),
});

const comparable = (isEqual: boolean) => ({
  equals: () => isEqual,
});

describe('FieldUpdateSemanticsVisitor', () => {
  const visitor = new FieldUpdateSemanticsVisitor();

  it.each([
    {
      name: 'TableUpdateFieldNameSpec',
      spec: protoInstance(TableUpdateFieldNameSpec),
      expected: semantics([['name', topLevel('name')]]),
    },
    {
      name: 'TableUpdateFieldDbFieldNameSpec',
      spec: protoInstance(TableUpdateFieldDbFieldNameSpec),
      expected: semantics([['dbFieldName', topLevel('dbFieldName')]]),
    },
    {
      name: 'TableUpdateFieldTypeSpec',
      spec: protoInstance(TableUpdateFieldTypeSpec),
      expected: semantics([
        ['type', topLevel('type', true)],
        ['options', optionsRoot()],
      ]),
    },
    {
      name: 'TableUpdateFieldAiConfigSpec',
      spec: protoInstance(TableUpdateFieldAiConfigSpec),
      expected: semantics([['aiConfig', topLevel('aiConfig')]]),
    },
    {
      name: 'TableUpdateFieldDescriptionSpec',
      spec: protoInstance(TableUpdateFieldDescriptionSpec),
      expected: semantics([['description', topLevel('description')]]),
    },
    {
      name: 'TableUpdateFieldHasErrorSpec',
      spec: protoInstance(TableUpdateFieldHasErrorSpec),
      expected: semantics([['hasError', topLevel('hasError')]]),
    },
    {
      name: 'UpdateSingleLineTextShowAsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateSingleLineTextShowAsSpec),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateSingleLineTextDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateSingleLineTextDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateLongTextDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateLongTextDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateNumberFormattingSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateNumberFormattingSpec),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateNumberShowAsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateNumberShowAsSpec),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateNumberDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateNumberDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateDateFormattingSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateDateFormattingSpec),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateDateDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateDateDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateCheckboxDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateCheckboxDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateRatingMaxSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRatingMaxSpec),
      expected: semantics([['max', optionBacked('max')]]),
    },
    {
      name: 'UpdateRatingIconSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRatingIconSpec),
      expected: semantics([['icon', optionBacked('icon')]]),
    },
    {
      name: 'UpdateRatingColorSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRatingColorSpec),
      expected: semantics([['color', optionBacked('color')]]),
    },
    {
      name: 'UpdateUserMultiplicitySpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateUserMultiplicitySpec),
      expected: semantics([['isMultiple', optionBacked('isMultiple')]]),
    },
    {
      name: 'UpdateUserNotificationSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateUserNotificationSpec),
      expected: semantics([['shouldNotify', optionBacked('shouldNotify')]]),
    },
    {
      name: 'UpdateUserDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateUserDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateButtonLabelSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateButtonLabelSpec),
      expected: semantics([['label', optionBacked('label')]]),
    },
    {
      name: 'UpdateButtonColorSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateButtonColorSpec),
      expected: semantics([['color', optionBacked('color')]]),
    },
    {
      name: 'UpdateButtonMaxCountSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateButtonMaxCountSpec),
      expected: semantics([['maxCount', optionBacked('maxCount')]]),
    },
    {
      name: 'UpdateButtonWorkflowSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateButtonWorkflowSpec),
      expected: semantics([['workflow', optionBacked('workflow')]]),
    },
    {
      name: 'UpdateSingleSelectOptionsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateSingleSelectOptionsSpec),
      expected: semantics([['options', optionsRoot()]]),
    },
    {
      name: 'UpdateSingleSelectDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateSingleSelectDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateSingleSelectAutoNewOptionsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateSingleSelectAutoNewOptionsSpec),
      expected: semantics([['autoNewOptions', optionBacked('preventAutoNewOptions')]]),
    },
    {
      name: 'UpdateMultipleSelectOptionsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateMultipleSelectOptionsSpec),
      expected: semantics([['options', optionsRoot()]]),
    },
    {
      name: 'UpdateMultipleSelectDefaultValueSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateMultipleSelectDefaultValueSpec),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateMultipleSelectAutoNewOptionsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateMultipleSelectAutoNewOptionsSpec),
      expected: semantics([['autoNewOptions', optionBacked('preventAutoNewOptions')]]),
    },
    {
      name: 'UpdateFormulaExpressionSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateFormulaExpressionSpec),
      expected: semantics([['expression', optionBacked('expression')]]),
    },
    {
      name: 'UpdateFormulaFormattingSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateFormulaFormattingSpec),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateFormulaShowAsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateFormulaShowAsSpec),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateFormulaTimeZoneSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateFormulaTimeZoneSpec),
      expected: semantics([['timeZone', optionBacked('timeZone')]]),
    },
    {
      name: 'UpdateLinkConfigSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateLinkConfigSpec),
      expected: semantics([['linkConfig', optionsRoot()]]),
    },
    {
      name: 'UpdateLookupOptionsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateLookupOptionsSpec),
      expected: semantics([['lookupOptions', topLevel('lookupOptions', true)]]),
    },
    {
      name: 'UpdateRollupConfigSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRollupConfigSpec),
      expected: semantics([['rollupConfig', rollupConfig()]]),
    },
    {
      name: 'UpdateRollupExpressionSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRollupExpressionSpec),
      expected: semantics([['expression', optionBacked('expression')]]),
    },
    {
      name: 'UpdateRollupFormattingSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRollupFormattingSpec),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateRollupShowAsSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRollupShowAsSpec),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateRollupTimeZoneSpec',
      spec: protoInstance(FieldUpdateSpecs.UpdateRollupTimeZoneSpec),
      expected: semantics([['timeZone', optionBacked('timeZone')]]),
    },
  ])('dispatches $name to the expected semantics', ({ spec, expected }) => {
    expect(visitor.visit(spec)).toEqual(expected);
  });

  it.each([
    {
      name: 'both constraint flags change',
      spec: protoInstance(TableUpdateFieldConstraintsSpec, {
        previousNotNull: () => comparable(false),
        nextNotNull: () => comparable(true),
        previousUnique: () => comparable(false),
        nextUnique: () => comparable(true),
      }),
      expected: semantics([
        ['notNull', topLevel('notNull')],
        ['unique', topLevel('unique')],
      ]),
    },
    {
      name: 'only notNull changes',
      spec: protoInstance(TableUpdateFieldConstraintsSpec, {
        previousNotNull: () => comparable(false),
        nextNotNull: () => comparable(true),
        previousUnique: () => comparable(true),
        nextUnique: () => comparable(true),
      }),
      expected: semantics([['notNull', topLevel('notNull')]]),
    },
    {
      name: 'no constraint flags change',
      spec: protoInstance(TableUpdateFieldConstraintsSpec, {
        previousNotNull: () => comparable(true),
        nextNotNull: () => comparable(true),
        previousUnique: () => comparable(true),
        nextUnique: () => comparable(true),
      }),
      expected: undefined,
    },
  ])('classifies constraints when $name', ({ spec, expected }) => {
    expect(visitor.visit(spec)).toEqual(expected);
  });

  it.each([
    {
      name: 'relationship type changes',
      spec: protoInstance(FieldUpdateSpecs.UpdateLinkRelationshipSpec, {
        isRelationshipTypeChanging: () => true,
        isOneWayChanging: () => false,
      }),
      expected: semantics([
        ['linkRelationship', optionsRoot()],
        ['relationship', optionBacked('relationship')],
      ]),
    },
    {
      name: 'one-way flag changes',
      spec: protoInstance(FieldUpdateSpecs.UpdateLinkRelationshipSpec, {
        isRelationshipTypeChanging: () => false,
        isOneWayChanging: () => true,
      }),
      expected: semantics([
        ['linkRelationship', optionsRoot()],
        ['isOneWay', optionBacked('isOneWay')],
      ]),
    },
    {
      name: 'both link relationship flags change',
      spec: protoInstance(FieldUpdateSpecs.UpdateLinkRelationshipSpec, {
        isRelationshipTypeChanging: () => true,
        isOneWayChanging: () => true,
      }),
      expected: semantics([
        ['linkRelationship', optionsRoot()],
        ['relationship', optionBacked('relationship')],
        ['isOneWay', optionBacked('isOneWay')],
      ]),
    },
  ])('classifies link relationship semantics when $name', ({ spec, expected }) => {
    expect(visitor.visit(spec)).toEqual(expected);
  });

  it('returns undefined for specs without field-updated semantics', () => {
    expect(
      visitor.visit(protoInstance(FieldUpdateSpecs.RemoveSymmetricLinkFieldSpec))
    ).toBeUndefined();
    expect(visitor.visit({})).toBeUndefined();
  });
});
