import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../domain/base/BaseId';
import { FieldId } from '../../../domain/table/fields/FieldId';
import { FieldName } from '../../../domain/table/fields/FieldName';
import { AttachmentField } from '../../../domain/table/fields/types/AttachmentField';
import { ButtonField } from '../../../domain/table/fields/types/ButtonField';
import { ButtonLabel } from '../../../domain/table/fields/types/ButtonLabel';
import { ButtonMaxCount } from '../../../domain/table/fields/types/ButtonMaxCount';
import { ButtonResetCount } from '../../../domain/table/fields/types/ButtonResetCount';
import { ButtonWorkflow } from '../../../domain/table/fields/types/ButtonWorkflow';
import { CellValueMultiplicity } from '../../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../../domain/table/fields/types/CellValueType';
import { CheckboxField } from '../../../domain/table/fields/types/CheckboxField';
import { ConditionalLookupField } from '../../../domain/table/fields/types/ConditionalLookupField';
import { ConditionalLookupOptions } from '../../../domain/table/fields/types/ConditionalLookupOptions';
import { DateDefaultValue } from '../../../domain/table/fields/types/DateDefaultValue';
import { DateField } from '../../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../../domain/table/fields/types/DateTimeFormatting';
import { FieldColor } from '../../../domain/table/fields/types/FieldColor';
import { FormulaExpression } from '../../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../../domain/table/fields/types/FormulaField';
import { LongTextField } from '../../../domain/table/fields/types/LongTextField';
import { LookupField } from '../../../domain/table/fields/types/LookupField';
import { MultipleSelectField } from '../../../domain/table/fields/types/MultipleSelectField';
import { NumberDefaultValue } from '../../../domain/table/fields/types/NumberDefaultValue';
import { NumberField } from '../../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../../domain/table/fields/types/NumberFormatting';
import { RatingColor } from '../../../domain/table/fields/types/RatingColor';
import { RatingField } from '../../../domain/table/fields/types/RatingField';
import { RatingIcon } from '../../../domain/table/fields/types/RatingIcon';
import { RatingMax } from '../../../domain/table/fields/types/RatingMax';
import { SelectAutoNewOptions } from '../../../domain/table/fields/types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../../../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../../../domain/table/fields/types/SelectOption';
import { SingleLineTextField } from '../../../domain/table/fields/types/SingleLineTextField';
import { SingleLineTextShowAs } from '../../../domain/table/fields/types/SingleLineTextShowAs';
import { SingleSelectField } from '../../../domain/table/fields/types/SingleSelectField';
import { TextDefaultValue } from '../../../domain/table/fields/types/TextDefaultValue';
import { UserDefaultValue } from '../../../domain/table/fields/types/UserDefaultValue';
import { UserField } from '../../../domain/table/fields/types/UserField';
import { UserMultiplicity } from '../../../domain/table/fields/types/UserMultiplicity';
import { UserNotification } from '../../../domain/table/fields/types/UserNotification';
import { Table } from '../../../domain/table/Table';
import { TableId } from '../../../domain/table/TableId';
import { TableName } from '../../../domain/table/TableName';
import { CalendarView } from '../../../domain/table/views/types/CalendarView';
import { FormView } from '../../../domain/table/views/types/FormView';
import { GalleryView } from '../../../domain/table/views/types/GalleryView';
import { GridView } from '../../../domain/table/views/types/GridView';
import { KanbanView } from '../../../domain/table/views/types/KanbanView';
import { PluginView } from '../../../domain/table/views/types/PluginView';
import { ViewColumnMeta } from '../../../domain/table/views/ViewColumnMeta';
import { ViewId } from '../../../domain/table/views/ViewId';
import { ViewName } from '../../../domain/table/views/ViewName';
import { ViewQueryDefaults } from '../../../domain/table/views/ViewQueryDefaults';
import { DefaultTableMapper } from './DefaultTableMapper';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);
const createViewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`);

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  const name = TableName.create('Mapper')._unsafeUnwrap();

  const fieldIds = [
    createFieldId('a'),
    createFieldId('b'),
    createFieldId('c'),
    createFieldId('d'),
    createFieldId('e'),
    createFieldId('f'),
    createFieldId('g'),
    createFieldId('h'),
    createFieldId('i'),
    createFieldId('j'),
    createFieldId('k'),
  ];
  const fieldNames = [
    FieldName.create('Title'),
    FieldName.create('Description'),
    FieldName.create('Amount'),
    FieldName.create('Rating'),
    FieldName.create('Status'),
    FieldName.create('Tags'),
    FieldName.create('Done'),
    FieldName.create('Files'),
    FieldName.create('Due'),
    FieldName.create('Owner'),
    FieldName.create('Action'),
  ];
  const [
    titleId,
    descriptionId,
    amountId,
    ratingId,
    statusId,
    tagsId,
    doneId,
    filesId,
    dueId,
    ownerId,
    actionId,
  ] = fieldIds.map((f) => f._unsafeUnwrap());

  const [
    titleName,
    descriptionName,
    amountName,
    ratingName,
    statusName,
    tagsName,
    doneName,
    filesName,
    dueName,
    ownerName,
    actionName,
  ] = fieldNames.map((f) => f._unsafeUnwrap());

  const showAs = SingleLineTextShowAs.create({ type: 'email' })._unsafeUnwrap();
  const textDefault = TextDefaultValue.create('hello')._unsafeUnwrap();
  const formatting = NumberFormatting.create({
    type: 'currency',
    precision: 2,
    symbol: '$',
  })._unsafeUnwrap();
  const numberDefault = NumberDefaultValue.create(10)._unsafeUnwrap();
  const ratingMax = RatingMax.create(5)._unsafeUnwrap();
  const ratingIcon = RatingIcon.create('star')._unsafeUnwrap();
  const ratingColor = RatingColor.create('yellowBright')._unsafeUnwrap();
  const optionTodo = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();
  const optionDone = SelectOption.create({ name: 'Done', color: 'green' })._unsafeUnwrap();
  const selectDefault = SelectDefaultValue.create('Todo')._unsafeUnwrap();
  const selectPrevent = SelectAutoNewOptions.prevent();
  const dateFormatting = DateTimeFormatting.create({
    date: 'YYYY-MM-DD',
    time: 'HH:mm',
    timeZone: 'utc',
  })._unsafeUnwrap();
  const dateDefault = DateDefaultValue.create('now')._unsafeUnwrap();
  const userMultiplicity = UserMultiplicity.create(true)._unsafeUnwrap();
  const userNotification = UserNotification.create(false)._unsafeUnwrap();
  const userDefault = UserDefaultValue.create(['me'])._unsafeUnwrap();
  const buttonLabel = ButtonLabel.create('Run')._unsafeUnwrap();
  const buttonColor = FieldColor.create('teal')._unsafeUnwrap();
  const buttonMax = ButtonMaxCount.create(3)._unsafeUnwrap();
  const buttonReset = ButtonResetCount.create(true)._unsafeUnwrap();
  const buttonWorkflow = ButtonWorkflow.create({
    id: `wfl${'a'.repeat(16)}`,
    name: 'Deploy',
    isActive: true,
  })._unsafeUnwrap();

  const fields = [
    SingleLineTextField.create({
      id: titleId,
      name: titleName,
      showAs,
    })._unsafeUnwrap(),

    LongTextField.create({
      id: descriptionId,
      name: descriptionName,
      defaultValue: textDefault,
    })._unsafeUnwrap(),

    NumberField.create({
      id: amountId,
      name: amountName,
      formatting,
      defaultValue: numberDefault,
    })._unsafeUnwrap(),

    RatingField.create({
      id: ratingId,
      name: ratingName,
      max: ratingMax,
      icon: ratingIcon,
      color: ratingColor,
    })._unsafeUnwrap(),

    SingleSelectField.create({
      id: statusId,
      name: statusName,
      options: [optionTodo, optionDone],
      defaultValue: selectDefault,
    })._unsafeUnwrap(),

    MultipleSelectField.create({
      id: tagsId,
      name: tagsName,
      options: [optionTodo, optionDone],
      preventAutoNewOptions: selectPrevent,
    })._unsafeUnwrap(),
    CheckboxField.create({ id: doneId, name: doneName })._unsafeUnwrap(),
    AttachmentField.create({ id: filesId, name: filesName })._unsafeUnwrap(),

    DateField.create({
      id: dueId,
      name: dueName,
      formatting: dateFormatting,
      defaultValue: dateDefault,
    })._unsafeUnwrap(),

    UserField.create({
      id: ownerId,
      name: ownerName,
      isMultiple: userMultiplicity,
      shouldNotify: userNotification,
      defaultValue: userDefault,
    })._unsafeUnwrap(),

    ButtonField.create({
      id: actionId,
      name: actionName,
      label: buttonLabel,
      color: buttonColor,
      maxCount: buttonMax,
      resetCount: buttonReset,
      workflow: buttonWorkflow,
    })._unsafeUnwrap(),
  ];

  const views = [
    GridView.create({
      id: createViewId('a')._unsafeUnwrap(),
      name: ViewName.create('Grid')._unsafeUnwrap(),
    })._unsafeUnwrap(),

    KanbanView.create({
      id: createViewId('b')._unsafeUnwrap(),
      name: ViewName.create('Kanban')._unsafeUnwrap(),
    })._unsafeUnwrap(),

    GalleryView.create({
      id: createViewId('c')._unsafeUnwrap(),
      name: ViewName.create('Gallery')._unsafeUnwrap(),
    })._unsafeUnwrap(),

    CalendarView.create({
      id: createViewId('d')._unsafeUnwrap(),
      name: ViewName.create('Calendar')._unsafeUnwrap(),
    })._unsafeUnwrap(),

    FormView.create({
      id: createViewId('e')._unsafeUnwrap(),
      name: ViewName.create('Form')._unsafeUnwrap(),
    })._unsafeUnwrap(),

    PluginView.create({
      id: createViewId('f')._unsafeUnwrap(),
      name: ViewName.create('Plugin')._unsafeUnwrap(),
    })._unsafeUnwrap(),
  ];

  views.forEach((view) => {
    const columnMeta = ViewColumnMeta.forView({
      viewType: view.type(),
      fields,
      primaryFieldId: titleId,
    })._unsafeUnwrap();
    view.setColumnMeta(columnMeta)._unsafeUnwrap();
    view.setQueryDefaults(ViewQueryDefaults.empty())._unsafeUnwrap();
  });

  return Table.rehydrate({
    id: tableId,
    baseId,
    name,
    fields,
    views,
    primaryFieldId: titleId,
  })._unsafeUnwrap();
};

const buildFormulaTable = () => {
  const baseId = BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const name = TableName.create('Formula')._unsafeUnwrap();
  const fieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const fieldName = FieldName.create('Total')._unsafeUnwrap();
  const expression = FormulaExpression.create('1')._unsafeUnwrap();
  const field = FormulaField.create({
    id: fieldId,
    name: fieldName,
    expression,
  })._unsafeUnwrap();
  field.setResultType(CellValueType.number(), CellValueMultiplicity.single())._unsafeUnwrap();

  const viewId = ViewId.create(`viw${'f'.repeat(16)}`)._unsafeUnwrap();
  const viewName = ViewName.create('Grid')._unsafeUnwrap();
  const view = GridView.create({ id: viewId, name: viewName })._unsafeUnwrap();
  const columnMeta = ViewColumnMeta.forView({
    viewType: view.type(),
    fields: [field],
    primaryFieldId: fieldId,
  })._unsafeUnwrap();
  view.setColumnMeta(columnMeta)._unsafeUnwrap();
  view.setQueryDefaults(ViewQueryDefaults.empty())._unsafeUnwrap();

  return Table.rehydrate({
    id: tableId,
    baseId,
    name,
    fields: [field],
    views: [view],
    primaryFieldId: fieldId,
  })._unsafeUnwrap();
};

describe('DefaultTableMapper', () => {
  it('maps tables to persistence dto and back', () => {
    const table = buildTable();
    if (!table) return;

    const mapper = new DefaultTableMapper();
    const dtoResult = mapper.toDTO(table);
    dtoResult._unsafeUnwrap();

    const dto = { ...dtoResult._unsafeUnwrap() };
    dto.dbTableName = 'db_table';
    dto.fields = dto.fields.map((field, index) =>
      index === 0 ? { ...field, dbFieldName: 'db_field' } : field
    );

    const domainResult = mapper.toDomain(dto);
    domainResult._unsafeUnwrap();

    const mapped = domainResult._unsafeUnwrap();
    expect(mapped.baseId().equals(table.baseId())).toBe(true);
    expect(mapped.name().equals(table.name())).toBe(true);
    expect(mapped.getFields().length).toBe(table.getFields().length);
    expect(mapped.views().length).toBe(table.views().length);
    mapped.dbTableName()._unsafeUnwrap();

    const fieldDbNameResult = mapped.getFields()[0]?.dbFieldName();
    fieldDbNameResult?._unsafeUnwrap();
  });

  it('marks formula fields as computed in persistence dto', () => {
    const table = buildFormulaTable();

    const mapper = new DefaultTableMapper();
    const dtoResult = mapper.toDTO(table);
    dtoResult._unsafeUnwrap();

    const formulaField = dtoResult._unsafeUnwrap().fields[0];
    expect(formulaField?.type).toBe('formula');
    expect(formulaField?.isComputed).toBe(true);
  });

  it('rehydrates conditional lookup inner field from innerType and innerOptions', () => {
    const table = buildTable();
    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();

    const conditionalLookupId = `fld${'z'.repeat(16)}`;
    const withConditionalLookup = {
      ...dto,
      fields: [
        ...dto.fields,
        {
          id: conditionalLookupId,
          name: 'Conditional Currency Lookup',
          type: 'conditionalLookup' as const,
          options: {
            foreignTableId: `tbl${'b'.repeat(16)}`,
            lookupFieldId: `fld${'c'.repeat(16)}`,
            condition: {
              filter: {
                conjunction: 'and' as const,
                filterSet: [{ fieldId: `fld${'d'.repeat(16)}`, operator: 'is', value: 'open' }],
              },
            },
          },
          innerType: 'number',
          innerOptions: {
            formatting: {
              type: 'currency',
              precision: 1,
              symbol: '¥',
            },
          },
          isLookup: true,
          isConditionalLookup: true,
          isComputed: true,
          isMultipleCellValue: true,
        },
      ],
    };

    const mapped = mapper.toDomain(withConditionalLookup)._unsafeUnwrap();
    const conditionalLookupField = mapped
      .getFields()
      .find((field) => field.id().equals(FieldId.create(conditionalLookupId)._unsafeUnwrap()));

    expect(conditionalLookupField).toBeInstanceOf(ConditionalLookupField);
    expect((conditionalLookupField as ConditionalLookupField).isPending()).toBe(false);

    const innerField = (conditionalLookupField as ConditionalLookupField)
      .innerField()
      ._unsafeUnwrap();
    expect(innerField).toBeInstanceOf(NumberField);
    expect((innerField as NumberField).formatting().toDto()).toEqual({
      type: 'currency',
      precision: 1,
      symbol: '¥',
    });
  });

  it('falls back to pending conditional lookup when inner field value type cannot be resolved', () => {
    const table = buildTable();
    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();

    const conditionalLookupId = `fld${'y'.repeat(16)}`;
    const withPendingInner = {
      ...dto,
      fields: [
        ...dto.fields,
        {
          id: conditionalLookupId,
          name: 'Conditional Formula Lookup',
          type: 'conditionalLookup' as const,
          options: {
            foreignTableId: `tbl${'b'.repeat(16)}`,
            lookupFieldId: `fld${'c'.repeat(16)}`,
            condition: {
              filter: {
                conjunction: 'and' as const,
                filterSet: [{ fieldId: `fld${'d'.repeat(16)}`, operator: 'is', value: 'open' }],
              },
            },
          },
          innerType: 'formula',
          innerOptions: {
            expression: '1',
          },
          isLookup: true,
          isConditionalLookup: true,
          isComputed: true,
          isMultipleCellValue: true,
        },
      ],
    };

    const mapped = mapper.toDomain(withPendingInner)._unsafeUnwrap();
    const conditionalLookupField = mapped
      .getFields()
      .find((field) => field.id().equals(FieldId.create(conditionalLookupId)._unsafeUnwrap()));

    expect(conditionalLookupField).toBeInstanceOf(ConditionalLookupField);
    expect((conditionalLookupField as ConditionalLookupField).isPending()).toBe(true);
  });

  it('merges conditional lookup inner options patch when persisting', () => {
    const baseId = BaseId.create(`bse${'m'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
    const primaryFieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
    const innerFieldId = FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap();
    const conditionalLookupId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();

    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Conditional Lookup Patch')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryFieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.addFieldFromResult(
      ConditionalLookupField.create({
        id: conditionalLookupId,
        name: FieldName.create('Amount Lookup')._unsafeUnwrap(),
        innerField: NumberField.create({
          id: innerFieldId,
          name: FieldName.create('Amount')._unsafeUnwrap(),
          formatting: NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap(),
        })._unsafeUnwrap(),
        conditionalLookupOptions: ConditionalLookupOptions.create({
          foreignTableId: `tbl${'p'.repeat(16)}`,
          lookupFieldId: `fld${'q'.repeat(16)}`,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: primaryFieldId.toString(), operator: 'is', value: 'open' }],
            },
          },
        })._unsafeUnwrap(),
        innerOptionsPatch: {
          formatting: {
            type: 'currency',
            precision: 1,
            symbol: '¥',
          },
        },
      })
    );
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();

    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();
    const persisted = dto.fields.find((field) => field.id === conditionalLookupId.toString()) as
      | (typeof dto.fields)[number]
      | undefined;

    expect(persisted?.type).toBe('conditionalLookup');
    if (!persisted || persisted.type !== 'conditionalLookup') {
      return;
    }
    expect(persisted.innerOptions).toEqual({
      formatting: {
        type: 'currency',
        precision: 1,
        symbol: '¥',
      },
    });
  });

  it('falls back to pending lookup when legacy link-lookup inner options are invalid', () => {
    const table = buildTable();
    const mapper = new DefaultTableMapper();
    const dto = mapper.toDTO(table)._unsafeUnwrap();

    const lookupId = `fld${'x'.repeat(16)}`;
    const withBrokenLinkLookup = {
      ...dto,
      fields: [
        ...dto.fields,
        {
          id: lookupId,
          name: 'Legacy Link Lookup',
          type: 'link' as const,
          options: {},
          lookupOptions: {
            linkFieldId: `fld${'a'.repeat(16)}`,
            foreignTableId: `tbl${'b'.repeat(16)}`,
            lookupFieldId: `fld${'c'.repeat(16)}`,
          },
          isLookup: true,
          isComputed: true,
        },
      ],
    } as unknown as Parameters<DefaultTableMapper['toDomain']>[0];

    const mapped = mapper.toDomain(withBrokenLinkLookup)._unsafeUnwrap();
    const lookupField = mapped
      .getFields()
      .find((field) => field.id().equals(FieldId.create(lookupId)._unsafeUnwrap()));

    expect(lookupField).toBeInstanceOf(LookupField);
    expect((lookupField as LookupField).isPending()).toBe(true);
  });
});
