import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { FieldCreated } from '../../../events/FieldCreated';
import { FieldDeleted } from '../../../events/FieldDeleted';
import { FieldUpdated, type FieldUpdatedPropertySemantics } from '../../../events/FieldUpdated';
import { TableRenamed } from '../../../events/TableRenamed';
import { ViewColumnMetaUpdated } from '../../../events/ViewColumnMetaUpdated';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { SingleLineTextField } from '../../../fields/types/SingleLineTextField';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import * as FieldUpdateSpecs from '../../field-updates';
import { TableAddFieldSpec } from '../../TableAddFieldSpec';
import { TableAddSelectOptionsSpec } from '../../TableAddSelectOptionsSpec';
import { TableByBaseIdSpec } from '../../TableByBaseIdSpec';
import { TableByIdSpec } from '../../TableByIdSpec';
import { TableByIdsSpec } from '../../TableByIdsSpec';
import { TableByIncomingReferenceToTableSpec } from '../../TableByIncomingReferenceToTableSpec';
import { TableByNameLikeSpec } from '../../TableByNameLikeSpec';
import { TableByNameSpec } from '../../TableByNameSpec';
import { TableDuplicateFieldSpec } from '../../TableDuplicateFieldSpec';
import { TableRemoveFieldSpec } from '../../TableRemoveFieldSpec';
import { TableRenameSpec } from '../../TableRenameSpec';
import { TableUpdateFieldAiConfigSpec } from '../../TableUpdateFieldAiConfigSpec';
import { TableUpdateFieldConstraintsSpec } from '../../TableUpdateFieldConstraintsSpec';
import { TableUpdateFieldDbFieldNameSpec } from '../../TableUpdateFieldDbFieldNameSpec';
import { TableUpdateFieldDescriptionSpec } from '../../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldHasErrorSpec } from '../../TableUpdateFieldHasErrorSpec';
import { TableUpdateFieldNameSpec } from '../../TableUpdateFieldNameSpec';
import { TableUpdateFieldTypeSpec } from '../../TableUpdateFieldTypeSpec';
import { TableUpdateViewColumnMetaSpec } from '../../TableUpdateViewColumnMetaSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../../TableUpdateViewQueryDefaultsSpec';
import { TableSpecEventVisitor } from '../TableSpecEventVisitor';

type PrototypeCtor<T extends object> = {
  prototype: T;
};

type FieldUpdateSpecSemantics = {
  readonly updatedProperties: ReadonlyArray<string>;
  readonly propertySemantics: Readonly<Record<string, FieldUpdatedPropertySemantics>>;
};

const protoInstance = <T extends object>(
  ctor: PrototypeCtor<T>,
  overrides: Record<string, unknown> = {}
): T => Object.assign(Object.create(ctor.prototype) as T, overrides as Partial<T>);

type UnsafeUnwrapResult = {
  _unsafeUnwrap(): void;
};

type AcceptableSpec = {
  accept(visitor: TableSpecEventVisitor): UnsafeUnwrapResult;
};

const acceptSpec = (visitor: TableSpecEventVisitor, spec: AcceptableSpec) => {
  spec.accept(visitor)._unsafeUnwrap();
};

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildTable = (seed: string) => {
  const baseId = createBaseId(seed);
  const tableName = TableName.create(`Table ${seed}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

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

const requiresPresence = (value: FieldUpdateSpecSemantics) =>
  value.updatedProperties.some((property) => value.propertySemantics[property]?.mayRequirePresence);

describe('TableSpecEventVisitor', () => {
  it.each([
    {
      name: 'TableUpdateFieldNameSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldNameSpec, { fieldId: () => fieldId }),
      expected: semantics([['name', topLevel('name')]]),
    },
    {
      name: 'TableUpdateFieldDbFieldNameSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldDbFieldNameSpec, { fieldId: () => fieldId }),
      expected: semantics([['dbFieldName', topLevel('dbFieldName')]]),
    },
    {
      name: 'TableUpdateFieldTypeSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldTypeSpec, {
          newField: () => ({ id: () => fieldId }),
        }),
      expected: semantics([
        ['type', topLevel('type', true)],
        ['options', optionsRoot()],
      ]),
    },
    {
      name: 'TableUpdateFieldConstraintsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldConstraintsSpec, {
          fieldId: () => fieldId,
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
      name: 'TableUpdateFieldAiConfigSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldAiConfigSpec, { fieldId: () => fieldId }),
      expected: semantics([['aiConfig', topLevel('aiConfig')]]),
    },
    {
      name: 'TableUpdateFieldDescriptionSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldDescriptionSpec, { fieldId: () => fieldId }),
      expected: semantics([['description', topLevel('description')]]),
    },
    {
      name: 'TableUpdateFieldHasErrorSpec',
      build: (fieldId: FieldId) =>
        protoInstance(TableUpdateFieldHasErrorSpec, { fieldId: () => fieldId }),
      expected: semantics([['hasError', topLevel('hasError')]]),
    },
    {
      name: 'UpdateSingleLineTextShowAsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateSingleLineTextShowAsSpec, { fieldId: () => fieldId }),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateSingleLineTextDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateSingleLineTextDefaultValueSpec, {
          fieldId: () => fieldId,
        }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateLongTextDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateLongTextDefaultValueSpec, { fieldId: () => fieldId }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateNumberFormattingSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateNumberFormattingSpec, { fieldId: () => fieldId }),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateNumberShowAsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateNumberShowAsSpec, { fieldId: () => fieldId }),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateNumberDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateNumberDefaultValueSpec, { fieldId: () => fieldId }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateDateFormattingSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateDateFormattingSpec, { fieldId: () => fieldId }),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateDateDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateDateDefaultValueSpec, { fieldId: () => fieldId }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateCheckboxDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateCheckboxDefaultValueSpec, { fieldId: () => fieldId }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateRatingMaxSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRatingMaxSpec, { fieldId: () => fieldId }),
      expected: semantics([['max', optionBacked('max')]]),
    },
    {
      name: 'UpdateRatingIconSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRatingIconSpec, { fieldId: () => fieldId }),
      expected: semantics([['icon', optionBacked('icon')]]),
    },
    {
      name: 'UpdateRatingColorSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRatingColorSpec, { fieldId: () => fieldId }),
      expected: semantics([['color', optionBacked('color')]]),
    },
    {
      name: 'UpdateUserMultiplicitySpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateUserMultiplicitySpec, { fieldId: () => fieldId }),
      expected: semantics([['isMultiple', optionBacked('isMultiple')]]),
    },
    {
      name: 'UpdateUserNotificationSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateUserNotificationSpec, { fieldId: () => fieldId }),
      expected: semantics([['shouldNotify', optionBacked('shouldNotify')]]),
    },
    {
      name: 'UpdateUserDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateUserDefaultValueSpec, { fieldId: () => fieldId }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateButtonLabelSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateButtonLabelSpec, { fieldId: () => fieldId }),
      expected: semantics([['label', optionBacked('label')]]),
    },
    {
      name: 'UpdateButtonColorSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateButtonColorSpec, { fieldId: () => fieldId }),
      expected: semantics([['color', optionBacked('color')]]),
    },
    {
      name: 'UpdateButtonMaxCountSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateButtonMaxCountSpec, { fieldId: () => fieldId }),
      expected: semantics([['maxCount', optionBacked('maxCount')]]),
    },
    {
      name: 'UpdateButtonWorkflowSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateButtonWorkflowSpec, { fieldId: () => fieldId }),
      expected: semantics([['workflow', optionBacked('workflow')]]),
    },
    {
      name: 'UpdateSingleSelectOptionsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateSingleSelectOptionsSpec, { fieldId: () => fieldId }),
      expected: semantics([['options', optionsRoot()]]),
    },
    {
      name: 'UpdateSingleSelectDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateSingleSelectDefaultValueSpec, {
          fieldId: () => fieldId,
        }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateSingleSelectAutoNewOptionsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateSingleSelectAutoNewOptionsSpec, {
          fieldId: () => fieldId,
        }),
      expected: semantics([['autoNewOptions', optionBacked('preventAutoNewOptions')]]),
    },
    {
      name: 'UpdateMultipleSelectOptionsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateMultipleSelectOptionsSpec, {
          fieldId: () => fieldId,
        }),
      expected: semantics([['options', optionsRoot()]]),
    },
    {
      name: 'UpdateMultipleSelectDefaultValueSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateMultipleSelectDefaultValueSpec, {
          fieldId: () => fieldId,
        }),
      expected: semantics([['defaultValue', optionBacked('defaultValue')]]),
    },
    {
      name: 'UpdateMultipleSelectAutoNewOptionsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateMultipleSelectAutoNewOptionsSpec, {
          fieldId: () => fieldId,
        }),
      expected: semantics([['autoNewOptions', optionBacked('preventAutoNewOptions')]]),
    },
    {
      name: 'UpdateFormulaExpressionSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateFormulaExpressionSpec, { fieldId: () => fieldId }),
      expected: semantics([['expression', optionBacked('expression')]]),
    },
    {
      name: 'UpdateFormulaFormattingSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateFormulaFormattingSpec, { fieldId: () => fieldId }),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateFormulaShowAsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateFormulaShowAsSpec, { fieldId: () => fieldId }),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateFormulaTimeZoneSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateFormulaTimeZoneSpec, { fieldId: () => fieldId }),
      expected: semantics([['timeZone', optionBacked('timeZone')]]),
    },
    {
      name: 'UpdateLinkConfigSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateLinkConfigSpec, { fieldId: () => fieldId }),
      expected: semantics([['linkConfig', optionsRoot()]]),
    },
    {
      name: 'UpdateLinkRelationshipSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateLinkRelationshipSpec, {
          fieldId: () => fieldId,
          isRelationshipTypeChanging: () => true,
          isOneWayChanging: () => true,
        }),
      expected: semantics([
        ['linkRelationship', optionsRoot()],
        ['relationship', optionBacked('relationship')],
        ['isOneWay', optionBacked('isOneWay')],
      ]),
    },
    {
      name: 'UpdateLookupOptionsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateLookupOptionsSpec, { fieldId: () => fieldId }),
      expected: semantics([['lookupOptions', topLevel('lookupOptions', true)]]),
    },
    {
      name: 'UpdateRollupConfigSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRollupConfigSpec, { fieldId: () => fieldId }),
      expected: semantics([['rollupConfig', rollupConfig()]]),
    },
    {
      name: 'UpdateRollupExpressionSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRollupExpressionSpec, { fieldId: () => fieldId }),
      expected: semantics([['expression', optionBacked('expression')]]),
    },
    {
      name: 'UpdateRollupFormattingSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRollupFormattingSpec, { fieldId: () => fieldId }),
      expected: semantics([['formatting', optionBacked('formatting')]]),
    },
    {
      name: 'UpdateRollupShowAsSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRollupShowAsSpec, { fieldId: () => fieldId }),
      expected: semantics([['showAs', optionBacked('showAs')]]),
    },
    {
      name: 'UpdateRollupTimeZoneSpec',
      build: (fieldId: FieldId) =>
        protoInstance(FieldUpdateSpecs.UpdateRollupTimeZoneSpec, { fieldId: () => fieldId }),
      expected: semantics([['timeZone', optionBacked('timeZone')]]),
    },
  ])('emits FieldUpdated for $name', ({ build, expected }) => {
    const table = buildTable('a');
    const visitor = TableSpecEventVisitor.create(table, table);
    const fieldId = table.getFields()[0].id();
    const spec = build(fieldId);

    acceptSpec(visitor, spec);

    const events = visitor.collectedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(FieldUpdated);

    const event = events[0] as FieldUpdated;
    expect(event.fieldId.equals(fieldId)).toBe(true);
    expect(event.updatedProperties).toEqual(expected.updatedProperties);
    expect(event.propertySemantics).toEqual(expected.propertySemantics);
    expect(event.mayRequirePresence()).toBe(requiresPresence(expected));
  });

  it('skips FieldUpdated when a field-constraint spec resolves to no changed properties', () => {
    const table = buildTable('b');
    const visitor = TableSpecEventVisitor.create(table, table);
    const fieldId = table.getFields()[0].id();
    const spec = protoInstance(TableUpdateFieldConstraintsSpec, {
      fieldId: () => fieldId,
      previousNotNull: () => comparable(true),
      nextNotNull: () => comparable(true),
      previousUnique: () => comparable(true),
      nextUnique: () => comparable(true),
    });

    acceptSpec(visitor, spec);

    expect(visitor.collectedEvents()).toHaveLength(0);
  });

  it('emits FieldDeleted for RemoveSymmetricLinkFieldSpec', () => {
    const table = buildTable('c');
    const visitor = TableSpecEventVisitor.create(table, table);
    const fieldId = table.getFields()[0].id();
    const spec = protoInstance(FieldUpdateSpecs.RemoveSymmetricLinkFieldSpec, {
      fieldId: () => fieldId,
    });

    acceptSpec(visitor, spec);

    const events = visitor.collectedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toBeInstanceOf(FieldDeleted);
  });

  it('emits structural events for add, remove, rename, and view-column updates', () => {
    const table = buildTable('d');
    const visitor = TableSpecEventVisitor.create(table, table);

    const newField = SingleLineTextField.create({
      id: createFieldId('z'),
      name: FieldName.create('Extra')._unsafeUnwrap(),
    })._unsafeUnwrap();
    TableAddFieldSpec.create(newField).accept(visitor)._unsafeUnwrap();
    TableRemoveFieldSpec.create(table.getFields()[0]).accept(visitor)._unsafeUnwrap();
    TableRenameSpec.create(
      TableName.create('Table d')._unsafeUnwrap(),
      TableName.create('Renamed')._unsafeUnwrap()
    )
      .accept(visitor)
      ._unsafeUnwrap();

    const view = table.views()[0];
    const viewMetaSpec = protoInstance(TableUpdateViewColumnMetaSpec, {
      updates: () => [
        {
          viewId: view.id(),
          columnMeta: view.columnMeta()._unsafeUnwrap(),
        },
      ],
    });
    acceptSpec(visitor, viewMetaSpec);

    const events = visitor.collectedEvents();
    expect(events.some((event) => event instanceof FieldCreated)).toBe(true);
    expect(events.some((event) => event instanceof FieldDeleted)).toBe(true);
    expect(events.some((event) => event instanceof TableRenamed)).toBe(true);
    expect(events.some((event) => event instanceof ViewColumnMetaUpdated)).toBe(true);
  });

  it('does not emit events for explicit no-op specs and query specs', () => {
    const table = buildTable('e');
    const visitor = TableSpecEventVisitor.create(table, table);

    [
      protoInstance(TableAddSelectOptionsSpec),
      protoInstance(TableDuplicateFieldSpec),
      protoInstance(TableUpdateViewQueryDefaultsSpec),
      protoInstance(TableByBaseIdSpec),
      protoInstance(TableByIdSpec),
      protoInstance(TableByIncomingReferenceToTableSpec),
      protoInstance(TableByIdsSpec),
      protoInstance(TableByNameSpec),
      protoInstance(TableByNameLikeSpec),
    ].forEach((spec) => {
      acceptSpec(visitor, spec);
    });

    expect(visitor.collectedEvents()).toHaveLength(0);
  });

  it('does not emit a rename event when the table name stays the same', () => {
    const table = buildTable('f');
    const visitor = TableSpecEventVisitor.create(table, table);
    const name = TableName.create('Table f')._unsafeUnwrap();

    TableRenameSpec.create(name, name).accept(visitor)._unsafeUnwrap();

    expect(visitor.collectedEvents()).toHaveLength(0);
  });
});
