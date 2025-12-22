import {
  BaseId,
  ButtonLabel,
  ButtonMaxCount,
  ButtonResetCount,
  ButtonWorkflow,
  CheckboxDefaultValue,
  DateDefaultValue,
  DateTimeFormatting,
  DbFieldName,
  DbTableName,
  FieldColor,
  FieldId,
  FieldName,
  type FormulaField,
  FormulaExpression,
  CellValueMultiplicity,
  CellValueType,
  NumberDefaultValue,
  NumberFormatting,
  NumberShowAs,
  RatingColor,
  RatingIcon,
  RatingMax,
  SelectAutoNewOptions,
  SelectDefaultValue,
  SelectOption,
  SingleLineTextShowAs,
  Table,
  TableId,
  TableName,
  TextDefaultValue,
  UserDefaultValue,
  UserMultiplicity,
  UserNotification,
  ViewId,
  ViewName,
  createAttachmentField,
  createButtonField,
  createCalendarView,
  createCheckboxField,
  createDateField,
  createFormView,
  createGalleryView,
  createGridView,
  createKanbanView,
  createLongTextField,
  createMultipleSelectField,
  createNumberField,
  createPluginView,
  createRatingField,
  createFormulaField,
  createSingleLineTextField,
  createSingleSelectField,
  createUserField,
  type Field,
  type View,
  TimeZone,
} from '@teable/v2-core';

import { err, ok, type Result } from 'neverthrow';
import { sequenceResults } from '../shared/neverthrow';
import type { IFieldDto, ITableDto, IViewDto } from './dto';

type FormulaFieldDto = Extract<IFieldDto, { type: 'formula' }>;

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, string>
): Result<T | undefined, string> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

const parseFormulaFormatting = (
  raw: unknown
): Result<NumberFormatting | DateTimeFormatting | undefined, string> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberFormatting.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const dateResult = DateTimeFormatting.create(raw);
  if (dateResult.isOk()) return ok(dateResult.value);
  return err('Invalid FormulaFormatting');
};

const parseFormulaShowAs = (
  raw: unknown
): Result<NumberShowAs | SingleLineTextShowAs | undefined, string> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberShowAs.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const textResult = SingleLineTextShowAs.create(raw);
  if (textResult.isOk()) return ok(textResult.value);
  return err('Invalid FormulaShowAs');
};

const applyDbFieldName = (field: Field, dbFieldName?: string): Result<Field, string> => {
  if (!dbFieldName) return ok(field);
  return DbFieldName.rehydrate(dbFieldName).andThen((value) =>
    field.setDbFieldName(value).map(() => field)
  );
};

const applyFormulaResultType = (
  field: FormulaField,
  cellValueType?: FormulaFieldDto['cellValueType'],
  isMultipleCellValue?: FormulaFieldDto['isMultipleCellValue']
): Result<FormulaField, string> => {
  if (cellValueType == null || isMultipleCellValue == null) return ok(field);
  return CellValueType.create(cellValueType).andThen((cellValueTypeValue) =>
    CellValueMultiplicity.create(isMultipleCellValue).andThen((isMultipleCellValueValue) =>
      field.setResultType(cellValueTypeValue, isMultipleCellValueValue).map(() => field)
    )
  );
};

const mapFieldDtoToDomain = (dto: IFieldDto): Result<Field, string> => {
  return FieldId.create(dto.id)
    .andThen((id) =>
      FieldName.create(dto.name).andThen((name) => {
        switch (dto.type) {
          case 'singleLineText': {
            return optional(dto.options?.showAs, SingleLineTextShowAs.create).andThen((showAs) =>
              optional(dto.options?.defaultValue, TextDefaultValue.create).andThen((defaultValue) =>
                createSingleLineTextField({ id, name, showAs, defaultValue })
              )
            );
          }
          case 'longText': {
            return optional(dto.options?.defaultValue, TextDefaultValue.create).andThen(
              (defaultValue) => createLongTextField({ id, name, defaultValue })
            );
          }
          case 'number': {
            return optional(dto.options?.formatting, NumberFormatting.create).andThen(
              (formatting) =>
                optional(dto.options?.showAs, NumberShowAs.create).andThen((showAs) =>
                  optional(dto.options?.defaultValue, NumberDefaultValue.create).andThen(
                    (defaultValue) =>
                      createNumberField({ id, name, formatting, showAs, defaultValue })
                  )
                )
            );
          }
          case 'rating': {
            return optional(dto.options?.max, RatingMax.create).andThen((max) =>
              optional(dto.options?.icon, RatingIcon.create).andThen((icon) =>
                optional(dto.options?.color, RatingColor.create).andThen((color) =>
                  createRatingField({ id, name, max, icon, color })
                )
              )
            );
          }
          case 'formula': {
            const options = dto.options;
            return FormulaExpression.create(options.expression).andThen((expression) =>
              optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
                parseFormulaFormatting(options.formatting).andThen((formatting) =>
                  parseFormulaShowAs(options.showAs).andThen((showAs) =>
                    createFormulaField({
                      id,
                      name,
                      expression,
                      timeZone,
                      formatting,
                      showAs,
                    }).andThen((field) =>
                      applyFormulaResultType(
                        field as FormulaField,
                        dto.cellValueType,
                        dto.isMultipleCellValue
                      ).map(() => field)
                    )
                  )
                )
              )
            );
          }
          case 'singleSelect': {
            const options = dto.options;
            const choices = options.choices;
            return sequenceResults(choices.map((choice) => SelectOption.create(choice))).andThen(
              (selectOptions) =>
                optional(options.defaultValue, SelectDefaultValue.create).andThen((defaultValue) =>
                  optional(options.preventAutoNewOptions, SelectAutoNewOptions.create).andThen(
                    (preventAutoNewOptions) =>
                      createSingleSelectField({
                        id,
                        name,
                        options: selectOptions,
                        defaultValue,
                        preventAutoNewOptions,
                      })
                  )
                )
            );
          }
          case 'multipleSelect': {
            const options = dto.options;
            const choices = options.choices;
            return sequenceResults(choices.map((choice) => SelectOption.create(choice))).andThen(
              (selectOptions) =>
                optional(options.defaultValue, SelectDefaultValue.create).andThen((defaultValue) =>
                  optional(options.preventAutoNewOptions, SelectAutoNewOptions.create).andThen(
                    (preventAutoNewOptions) =>
                      createMultipleSelectField({
                        id,
                        name,
                        options: selectOptions,
                        defaultValue,
                        preventAutoNewOptions,
                      })
                  )
                )
            );
          }
          case 'checkbox': {
            return optional(dto.options?.defaultValue, CheckboxDefaultValue.create).andThen(
              (defaultValue) => createCheckboxField({ id, name, defaultValue })
            );
          }
          case 'attachment': {
            return createAttachmentField({ id, name });
          }
          case 'date': {
            return optional(dto.options?.formatting, DateTimeFormatting.create).andThen(
              (formatting) =>
                optional(dto.options?.defaultValue, DateDefaultValue.create).andThen(
                  (defaultValue) => createDateField({ id, name, formatting, defaultValue })
                )
            );
          }
          case 'user': {
            return optional(dto.options?.isMultiple, UserMultiplicity.create).andThen(
              (isMultiple) =>
                optional(dto.options?.shouldNotify, UserNotification.create).andThen(
                  (shouldNotify) =>
                    optional(dto.options?.defaultValue, UserDefaultValue.create).andThen(
                      (defaultValue) =>
                        createUserField({ id, name, isMultiple, shouldNotify, defaultValue })
                    )
                )
            );
          }
          case 'button': {
            const options = dto.options;
            const workflowResult = ButtonWorkflow.create(options?.workflow);
            return optional(options?.label, ButtonLabel.create).andThen((label) =>
              optional(options?.color, FieldColor.create).andThen((color) =>
                optional(options?.maxCount, ButtonMaxCount.create).andThen((maxCount) =>
                  optional(options?.resetCount, ButtonResetCount.create).andThen((resetCount) =>
                    workflowResult.andThen((workflow) =>
                      createButtonField({
                        id,
                        name,
                        label,
                        color,
                        maxCount,
                        resetCount,
                        workflow,
                      })
                    )
                  )
                )
              )
            );
          }
          default:
            return err('Unsupported field type');
        }
      })
    )
    .andThen((field) => applyDbFieldName(field, dto.dbFieldName));
};

const mapViewDtoToDomain = (dto: IViewDto): Result<View, string> => {
  return ViewId.create(dto.id).andThen((id) =>
    ViewName.create(dto.name).andThen((name) => {
      switch (dto.type) {
        case 'grid':
          return createGridView({ id, name });
        case 'kanban':
          return createKanbanView({ id, name });
        case 'gallery':
          return createGalleryView({ id, name });
        case 'calendar':
          return createCalendarView({ id, name });
        case 'form':
          return createFormView({ id, name });
        case 'plugin':
          return createPluginView({ id, name });
        default:
          return err('Unsupported view type');
      }
    })
  );
};

export const mapTableDtoToDomain = (table: ITableDto): Result<Table, string> => {
  const primaryFields = table.fields.filter((field) => field.isPrimary);
  if (primaryFields.length === 0) return err('Primary field missing in table dto');
  if (primaryFields.length > 1) return err('Multiple primary fields in table dto');

  return TableId.create(table.id).andThen((id) =>
    BaseId.create(table.baseId).andThen((baseId) =>
      TableName.create(table.name).andThen((name) =>
        FieldId.create(primaryFields[0].id).andThen((primaryFieldId) =>
          sequenceResults(table.fields.map(mapFieldDtoToDomain)).andThen((fields) =>
            sequenceResults(table.views.map(mapViewDtoToDomain)).andThen((views) =>
              optional(table.dbTableName, DbTableName.rehydrate).andThen((dbTableName) => {
                const props = {
                  id,
                  baseId,
                  name,
                  primaryFieldId,
                  fields,
                  views,
                  ...(dbTableName ? { dbTableName } : {}),
                };
                return Table.rehydrate(props);
              })
            )
          )
        )
      )
    )
  );
};
