import type { Result } from 'neverthrow';
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
import { CheckboxField } from '../../../domain/table/fields/types/CheckboxField';
import { DateDefaultValue } from '../../../domain/table/fields/types/DateDefaultValue';
import { DateField } from '../../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../../domain/table/fields/types/DateTimeFormatting';
import { FieldColor } from '../../../domain/table/fields/types/FieldColor';
import { LongTextField } from '../../../domain/table/fields/types/LongTextField';
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
import { ViewId } from '../../../domain/table/views/ViewId';
import { ViewName } from '../../../domain/table/views/ViewName';
import { DefaultTableMapper } from './DefaultTableMapper';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);
const createViewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`);

const unwrap = <T>(result: Result<T, string>): T => {
  if (result.isErr()) {
    throw new Error(result.error);
  }
  return result.value;
};

const buildTable = () => {
  const baseId = unwrap(BaseId.create(`bse${'a'.repeat(16)}`));
  const tableId = unwrap(TableId.create(`tbl${'a'.repeat(16)}`));
  const name = unwrap(TableName.create('Mapper'));

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
  ] = fieldIds.map(unwrap);

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
  ] = fieldNames.map(unwrap);

  const showAs = unwrap(SingleLineTextShowAs.create({ type: 'email' }));
  const textDefault = unwrap(TextDefaultValue.create('hello'));
  const formatting = unwrap(
    NumberFormatting.create({
      type: 'currency',
      precision: 2,
      symbol: '$',
    })
  );
  const numberDefault = unwrap(NumberDefaultValue.create(10));
  const ratingMax = unwrap(RatingMax.create(5));
  const ratingIcon = unwrap(RatingIcon.create('star'));
  const ratingColor = unwrap(RatingColor.create('yellowBright'));
  const optionTodo = unwrap(SelectOption.create({ name: 'Todo', color: 'blue' }));
  const optionDone = unwrap(SelectOption.create({ name: 'Done', color: 'green' }));
  const selectDefault = unwrap(SelectDefaultValue.create('Todo'));
  const selectPrevent = SelectAutoNewOptions.prevent();
  const dateFormatting = unwrap(
    DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'utc',
    })
  );
  const dateDefault = unwrap(DateDefaultValue.create('now'));
  const userMultiplicity = unwrap(UserMultiplicity.create(true));
  const userNotification = unwrap(UserNotification.create(false));
  const userDefault = unwrap(UserDefaultValue.create(['me']));
  const buttonLabel = unwrap(ButtonLabel.create('Run'));
  const buttonColor = unwrap(FieldColor.create('teal'));
  const buttonMax = unwrap(ButtonMaxCount.create(3));
  const buttonReset = unwrap(ButtonResetCount.create(true));
  const buttonWorkflow = unwrap(
    ButtonWorkflow.create({
      id: `wfl${'a'.repeat(16)}`,
      name: 'Deploy',
      isActive: true,
    })
  );

  const fields = [
    unwrap(
      SingleLineTextField.create({
        id: titleId,
        name: titleName,
        showAs,
      })
    ),
    unwrap(
      LongTextField.create({
        id: descriptionId,
        name: descriptionName,
        defaultValue: textDefault,
      })
    ),
    unwrap(
      NumberField.create({
        id: amountId,
        name: amountName,
        formatting,
        defaultValue: numberDefault,
      })
    ),
    unwrap(
      RatingField.create({
        id: ratingId,
        name: ratingName,
        max: ratingMax,
        icon: ratingIcon,
        color: ratingColor,
      })
    ),
    unwrap(
      SingleSelectField.create({
        id: statusId,
        name: statusName,
        options: [optionTodo, optionDone],
        defaultValue: selectDefault,
      })
    ),
    unwrap(
      MultipleSelectField.create({
        id: tagsId,
        name: tagsName,
        options: [optionTodo, optionDone],
        preventAutoNewOptions: selectPrevent,
      })
    ),
    unwrap(CheckboxField.create({ id: doneId, name: doneName })),
    unwrap(AttachmentField.create({ id: filesId, name: filesName })),
    unwrap(
      DateField.create({
        id: dueId,
        name: dueName,
        formatting: dateFormatting,
        defaultValue: dateDefault,
      })
    ),
    unwrap(
      UserField.create({
        id: ownerId,
        name: ownerName,
        isMultiple: userMultiplicity,
        shouldNotify: userNotification,
        defaultValue: userDefault,
      })
    ),
    unwrap(
      ButtonField.create({
        id: actionId,
        name: actionName,
        label: buttonLabel,
        color: buttonColor,
        maxCount: buttonMax,
        resetCount: buttonReset,
        workflow: buttonWorkflow,
      })
    ),
  ];

  const views = [
    unwrap(
      GridView.create({
        id: unwrap(createViewId('a')),
        name: unwrap(ViewName.create('Grid')),
      })
    ),
    unwrap(
      KanbanView.create({
        id: unwrap(createViewId('b')),
        name: unwrap(ViewName.create('Kanban')),
      })
    ),
    unwrap(
      GalleryView.create({
        id: unwrap(createViewId('c')),
        name: unwrap(ViewName.create('Gallery')),
      })
    ),
    unwrap(
      CalendarView.create({
        id: unwrap(createViewId('d')),
        name: unwrap(ViewName.create('Calendar')),
      })
    ),
    unwrap(
      FormView.create({
        id: unwrap(createViewId('e')),
        name: unwrap(ViewName.create('Form')),
      })
    ),
    unwrap(
      PluginView.create({
        id: unwrap(createViewId('f')),
        name: unwrap(ViewName.create('Plugin')),
      })
    ),
  ];

  return unwrap(
    Table.rehydrate({
      id: tableId,
      baseId,
      name,
      fields,
      views,
      primaryFieldId: titleId,
    })
  );
};

describe('DefaultTableMapper', () => {
  it('maps tables to persistence dto and back', () => {
    const table = buildTable();
    if (!table) return;

    const mapper = new DefaultTableMapper();
    const dtoResult = mapper.toDTO(table);
    expect(dtoResult.isOk()).toBe(true);
    if (dtoResult.isErr()) return;

    const dto = { ...dtoResult.value };
    dto.dbTableName = 'db_table';
    dto.fields = dto.fields.map((field, index) =>
      index === 0 ? { ...field, dbFieldName: 'db_field' } : field
    );

    const domainResult = mapper.toDomain(dto);
    expect(domainResult.isOk()).toBe(true);
    if (domainResult.isErr()) return;
    const mapped = domainResult.value;
    expect(mapped.baseId().equals(table.baseId())).toBe(true);
    expect(mapped.name().equals(table.name())).toBe(true);
    expect(mapped.fields().length).toBe(table.fields().length);
    expect(mapped.views().length).toBe(table.views().length);
    expect(mapped.dbTableName().isOk()).toBe(true);

    const fieldDbNameResult = mapped.fields()[0]?.dbFieldName();
    expect(fieldDbNameResult?.isOk()).toBe(true);
  });
});
