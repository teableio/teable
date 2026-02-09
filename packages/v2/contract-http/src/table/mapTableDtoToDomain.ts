import {
  BaseId,
  ButtonLabel,
  ButtonMaxCount,
  ButtonResetCount,
  ButtonWorkflow,
  CheckboxDefaultValue,
  ConditionalLookupOptions,
  ConditionalRollupConfig,
  DateDefaultValue,
  DateTimeFormatting,
  DbFieldName,
  DbTableName,
  FieldColor,
  FieldNotNull,
  FieldUnique,
  FieldId,
  FieldName,
  FormulaExpression,
  LookupOptions,
  RollupExpression,
  CellValueMultiplicity,
  CellValueType,
  LinkFieldConfig,
  LinkFieldMeta,
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
  ViewColumnMeta,
  ViewId,
  ViewName,
  createAttachmentField,
  createAutoNumberField,
  createButtonField,
  createCalendarView,
  createCheckboxField,
  createConditionalLookupFieldPending,
  createConditionalRollupFieldPending,
  createCreatedByField,
  createCreatedTimeField,
  createDateField,
  createFormView,
  createGalleryView,
  createGridView,
  createKanbanView,
  createLastModifiedByField,
  createLastModifiedTimeField,
  createLookupFieldPending,
  createLinkField,
  createLongTextField,
  createMultipleSelectField,
  createNumberField,
  createPluginView,
  createRatingField,
  createFormulaField,
  createRollupFieldPending,
  createSingleLineTextField,
  createSingleSelectField,
  createUserField,
  TimeZone,
  RollupFieldConfig,
  domainError,
} from '@teable/v2-core';
import type { DomainError, FormulaField, Field, View } from '@teable/v2-core';

import { err, ok, type Result } from 'neverthrow';
import { sequenceResults } from '../shared/neverthrow';
import type { IFieldDto, ITableDto, IViewDto } from './dto';

type FormulaFieldDto = Extract<IFieldDto, { type: 'formula' }>;

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, DomainError>
): Result<T | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

const parseFormulaFormatting = (
  raw: unknown
): Result<NumberFormatting | DateTimeFormatting | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberFormatting.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const dateResult = DateTimeFormatting.create(raw);
  if (dateResult.isOk()) return ok(dateResult.value);
  // Provide detailed error message including raw value and individual parse errors
  const rawStr = JSON.stringify(raw);
  const numberErr = numberResult.isErr() ? numberResult.error.message : 'unknown';
  const dateErr = dateResult.isErr() ? dateResult.error.message : 'unknown';
  return err(
    domainError.validation({
      message: `Invalid FormulaFormatting: ${rawStr} (NumberFormatting: ${numberErr}, DateTimeFormatting: ${dateErr})`,
    })
  );
};

const parseFormulaShowAs = (
  raw: unknown
): Result<NumberShowAs | SingleLineTextShowAs | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  const numberResult = NumberShowAs.create(raw);
  if (numberResult.isOk()) return ok(numberResult.value);
  const textResult = SingleLineTextShowAs.create(raw);
  if (textResult.isOk()) return ok(textResult.value);
  return err(domainError.validation({ message: 'Invalid FormulaShowAs' }));
};

const parseTrackedFieldIds = (raw: unknown): Result<ReadonlyArray<FieldId>, DomainError> => {
  if (raw == null) return ok([]);
  if (!Array.isArray(raw))
    return err(domainError.validation({ message: 'Invalid trackedFieldIds' }));
  return sequenceResults(raw.map((entry) => FieldId.create(entry)));
};

const applyDbFieldName = (field: Field, dbFieldName?: string): Result<Field, DomainError> => {
  if (!dbFieldName) return ok(field);
  return DbFieldName.rehydrate(dbFieldName).andThen((value) =>
    field.setDbFieldName(value).map(() => field)
  );
};

const applyFieldValidation = (
  field: Field,
  notNullRaw?: boolean,
  uniqueRaw?: boolean
): Result<Field, DomainError> => {
  const notNullResult =
    typeof notNullRaw === 'boolean' ? FieldNotNull.create(notNullRaw) : ok(FieldNotNull.optional());
  const uniqueResult =
    typeof uniqueRaw === 'boolean' ? FieldUnique.create(uniqueRaw) : ok(FieldUnique.disabled());

  return notNullResult.andThen((notNull) =>
    uniqueResult
      .andThen((unique) => field.setNotNull(notNull).andThen(() => field.setUnique(unique)))
      .map(() => field)
  );
};

const applyFormulaResultType = (
  field: FormulaField,
  cellValueType?: FormulaFieldDto['cellValueType'],
  isMultipleCellValue?: FormulaFieldDto['isMultipleCellValue']
): Result<FormulaField, DomainError> => {
  if (cellValueType == null || isMultipleCellValue == null) return ok(field);
  return CellValueType.create(cellValueType).andThen((cellValueTypeValue) =>
    CellValueMultiplicity.create(isMultipleCellValue).andThen((isMultipleCellValueValue) =>
      field.setResultType(cellValueTypeValue, isMultipleCellValueValue).map(() => field)
    )
  );
};

const mapFieldDtoToDomain = (dto: IFieldDto): Result<Field, DomainError> => {
  return FieldId.create(dto.id).andThen((id) =>
    FieldName.create(dto.name).andThen((name) => {
      if (dto.isLookup && dto.conditionalLookupOptions) {
        return ConditionalLookupOptions.create(dto.conditionalLookupOptions).andThen(
          (conditionalLookupOptions) =>
            createConditionalLookupFieldPending({ id, name, conditionalLookupOptions })
              .andThen((field) => applyFieldValidation(field, dto.notNull, dto.unique))
              .andThen((field) => applyDbFieldName(field, dto.dbFieldName))
        );
      }
      if (dto.isLookup && dto.lookupOptions) {
        return LookupOptions.create(dto.lookupOptions).andThen((lookupOptions) =>
          createLookupFieldPending({ id, name, lookupOptions })
            .andThen((field) => applyFieldValidation(field, dto.notNull, dto.unique))
            .andThen((field) => applyDbFieldName(field, dto.dbFieldName))
        );
      }

      return mapBaseFieldDtoToDomain(dto, id, name);
    })
  );
};

const mapBaseFieldDtoToDomain = (
  dto: IFieldDto,
  id: FieldId,
  name: FieldName
): Result<Field, DomainError> => {
  const baseResult = (() => {
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
        return optional(dto.options?.formatting, NumberFormatting.create).andThen((formatting) =>
          optional(dto.options?.showAs, NumberShowAs.create).andThen((showAs) =>
            optional(dto.options?.defaultValue, NumberDefaultValue.create).andThen((defaultValue) =>
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
      case 'rollup': {
        const options = dto.options;
        return RollupExpression.create(options.expression).andThen((expression) =>
          RollupFieldConfig.create(dto.config).andThen((config) =>
            optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
              parseFormulaFormatting(options.formatting).andThen((formatting) =>
                parseFormulaShowAs(options.showAs).andThen((showAs) =>
                  createRollupFieldPending({
                    id,
                    name,
                    config,
                    expression,
                    timeZone,
                    formatting,
                    showAs,
                  })
                )
              )
            )
          )
        );
      }
      case 'conditionalRollup': {
        const options = dto.options;
        return RollupExpression.create(options.expression).andThen((expression) =>
          ConditionalRollupConfig.create(dto.config).andThen((config) =>
            optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
              parseFormulaFormatting(options.formatting).andThen((formatting) =>
                parseFormulaShowAs(options.showAs).andThen((showAs) =>
                  createConditionalRollupFieldPending({
                    id,
                    name,
                    config,
                    expression,
                    timeZone,
                    formatting,
                    showAs,
                  })
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
        return optional(dto.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
          optional(dto.options?.defaultValue, DateDefaultValue.create).andThen((defaultValue) =>
            createDateField({ id, name, formatting, defaultValue })
          )
        );
      }
      case 'createdTime': {
        return optional(dto.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
          createCreatedTimeField({ id, name, formatting })
        );
      }
      case 'lastModifiedTime': {
        return optional(dto.options?.formatting, DateTimeFormatting.create).andThen((formatting) =>
          parseTrackedFieldIds(dto.options?.trackedFieldIds).andThen((trackedFieldIds) =>
            createLastModifiedTimeField({ id, name, formatting, trackedFieldIds })
          )
        );
      }
      case 'user': {
        return optional(dto.options?.isMultiple, UserMultiplicity.create).andThen((isMultiple) =>
          optional(dto.options?.shouldNotify, UserNotification.create).andThen((shouldNotify) =>
            optional(dto.options?.defaultValue, UserDefaultValue.create).andThen((defaultValue) =>
              createUserField({ id, name, isMultiple, shouldNotify, defaultValue })
            )
          )
        );
      }
      case 'createdBy': {
        return createCreatedByField({ id, name });
      }
      case 'lastModifiedBy': {
        return parseTrackedFieldIds(dto.options?.trackedFieldIds).andThen((trackedFieldIds) =>
          createLastModifiedByField({ id, name, trackedFieldIds })
        );
      }
      case 'autoNumber': {
        return createAutoNumberField({ id, name });
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
      case 'link': {
        return LinkFieldConfig.create(dto.options).andThen((config) =>
          LinkFieldMeta.create({}).andThen((meta) =>
            createLinkField({ id, name, config, meta: meta ?? undefined })
          )
        );
      }
      default:
        return err(domainError.validation({ message: 'Unsupported field type' }));
    }
  })();

  return baseResult
    .andThen((field) => applyFieldValidation(field, dto.notNull, dto.unique))
    .andThen((field) => applyDbFieldName(field, dto.dbFieldName));
};

const mapViewDtoToDomain = (dto: IViewDto): Result<View, DomainError> => {
  return ViewId.create(dto.id).andThen((id) =>
    ViewName.create(dto.name).andThen((name) => {
      const viewResult = (() => {
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
            return err(domainError.validation({ message: 'Unsupported view type' }));
        }
      })();

      return viewResult.andThen((view) =>
        ViewColumnMeta.rehydrate(dto.columnMeta).andThen((columnMeta) =>
          view.setColumnMeta(columnMeta).map(() => view)
        )
      );
    })
  );
};

export const mapTableDtoToDomain = (table: ITableDto): Result<Table, DomainError> => {
  const primaryFields = table.fields.filter((field) => field.isPrimary);
  if (primaryFields.length === 0)
    return err(domainError.validation({ message: 'Primary field missing in table dto' }));
  if (primaryFields.length > 1)
    return err(domainError.unexpected({ message: 'Multiple primary fields in table dto' }));

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
