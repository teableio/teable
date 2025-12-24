import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import { BaseId } from '../../../domain/base/BaseId';
import { DbTableName } from '../../../domain/table/DbTableName';
import { DbFieldName } from '../../../domain/table/fields/DbFieldName';
import type { Field } from '../../../domain/table/fields/Field';
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
import { CheckboxDefaultValue } from '../../../domain/table/fields/types/CheckboxDefaultValue';
import { CheckboxField } from '../../../domain/table/fields/types/CheckboxField';
import { DateDefaultValue } from '../../../domain/table/fields/types/DateDefaultValue';
import { DateField } from '../../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../../domain/table/fields/types/DateTimeFormatting';
import { FieldColor } from '../../../domain/table/fields/types/FieldColor';
import { FormulaExpression } from '../../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../../domain/table/fields/types/FormulaField';
import { FormulaMeta } from '../../../domain/table/fields/types/FormulaMeta';
import { LongTextField } from '../../../domain/table/fields/types/LongTextField';
import { MultipleSelectField } from '../../../domain/table/fields/types/MultipleSelectField';
import { NumberDefaultValue } from '../../../domain/table/fields/types/NumberDefaultValue';
import { NumberField } from '../../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../../domain/table/fields/types/NumberFormatting';
import { NumberShowAs } from '../../../domain/table/fields/types/NumberShowAs';
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
import { TimeZone } from '../../../domain/table/fields/types/TimeZone';
import { UserDefaultValue } from '../../../domain/table/fields/types/UserDefaultValue';
import { UserField } from '../../../domain/table/fields/types/UserField';
import { UserMultiplicity } from '../../../domain/table/fields/types/UserMultiplicity';
import { UserNotification } from '../../../domain/table/fields/types/UserNotification';
import type { IFieldVisitor } from '../../../domain/table/fields/visitors/IFieldVisitor';
import type { Table } from '../../../domain/table/Table';
import { Table as TableAggregate } from '../../../domain/table/Table';
import type { ITableBuildProps } from '../../../domain/table/TableBuilder';
import { TableId } from '../../../domain/table/TableId';
import { TableName } from '../../../domain/table/TableName';
import { CalendarView } from '../../../domain/table/views/types/CalendarView';
import { FormView } from '../../../domain/table/views/types/FormView';
import { GalleryView } from '../../../domain/table/views/types/GalleryView';
import { GridView } from '../../../domain/table/views/types/GridView';
import { KanbanView } from '../../../domain/table/views/types/KanbanView';
import { PluginView } from '../../../domain/table/views/types/PluginView';
import type { View } from '../../../domain/table/views/View';
import { ViewColumnMeta } from '../../../domain/table/views/ViewColumnMeta';
import { ViewId } from '../../../domain/table/views/ViewId';
import { ViewName } from '../../../domain/table/views/ViewName';
import type { IViewVisitor } from '../../../domain/table/views/visitors/IViewVisitor';
import type {
  IButtonFieldOptionsDTO,
  ICheckboxFieldOptionsDTO,
  IDateFieldOptionsDTO,
  IFormulaFieldMetaDTO,
  IFormulaFieldOptionsDTO,
  ILongTextFieldOptionsDTO,
  INumberFieldOptionsDTO,
  IRatingFieldOptionsDTO,
  ISelectFieldOptionsDTO,
  ISingleLineTextFieldOptionsDTO,
  IUserFieldOptionsDTO,
  ITableFieldPersistenceDTO,
  ITableMapper,
  ITablePersistenceDTO,
  ITableViewPersistenceDTO,
} from '../TableMapper';

const sequenceResults = <T>(
  values: ReadonlyArray<Result<T, string>>
): Result<ReadonlyArray<T>, string> =>
  values.reduce<Result<ReadonlyArray<T>, string>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

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

const parseFormulaResultType = (
  cellValueTypeRaw: unknown,
  isMultipleCellValueRaw: unknown
): Result<
  { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity } | undefined,
  string
> => {
  if (cellValueTypeRaw == null || typeof isMultipleCellValueRaw !== 'boolean') {
    return ok(undefined);
  }
  return CellValueType.create(cellValueTypeRaw).andThen((cellValueType) =>
    CellValueMultiplicity.create(isMultipleCellValueRaw).map((isMultipleCellValue) => ({
      cellValueType,
      isMultipleCellValue,
    }))
  );
};

class FieldToPersistenceVisitor implements IFieldVisitor<ITableFieldPersistenceDTO> {
  visitSingleLineTextField(field: SingleLineTextField): Result<ITableFieldPersistenceDTO, string> {
    const options: ISingleLineTextFieldOptionsDTO = {};
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'singleLineText',
      options,
    });
  }

  visitLongTextField(field: LongTextField): Result<ITableFieldPersistenceDTO, string> {
    const options: ILongTextFieldOptionsDTO = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'longText',
      options,
    });
  }

  visitNumberField(field: NumberField): Result<ITableFieldPersistenceDTO, string> {
    const options: INumberFieldOptionsDTO = {
      formatting: field.formatting().toDto(),
    };
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toNumber();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'number',
      options,
    });
  }

  visitRatingField(field: RatingField): Result<ITableFieldPersistenceDTO, string> {
    const options: IRatingFieldOptionsDTO = {
      icon: field.ratingIcon().toString(),
      color: field.ratingColor().toString(),
      max: field.ratingMax().toNumber(),
    };

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'rating',
      options,
    });
  }

  visitFormulaField(field: FormulaField): Result<ITableFieldPersistenceDTO, string> {
    const expression = field.expression().toString();
    const options: IFormulaFieldOptionsDTO = { expression };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const meta = field.meta();
    const isComputed = field.computed().toBoolean();

    return field
      .cellValueType()
      .andThen((cellValueType) =>
        field.isMultipleCellValue().map((isMultipleCellValue) => ({
          cellValueType,
          isMultipleCellValue,
        }))
      )
      .andThen(({ cellValueType, isMultipleCellValue }) =>
        (meta ? meta.toDto() : ok(undefined)).map((metaDto) => ({
          id: field.id().toString(),
          name: field.name().toString(),
          type: 'formula' as const,
          options,
          ...(metaDto ? { meta: metaDto as IFormulaFieldMetaDTO } : {}),
          cellValueType: cellValueType.toString(),
          isMultipleCellValue: isMultipleCellValue.toBoolean(),
          isComputed,
        }))
      );
  }

  visitSingleSelectField(field: SingleSelectField): Result<ITableFieldPersistenceDTO, string> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const options: ISelectFieldOptionsDTO = {
      choices: field.selectOptions().map((option) => option.toDto()),
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
      ...(preventAutoNewOptions ? { preventAutoNewOptions } : {}),
    };

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'singleSelect',
      options,
    });
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<ITableFieldPersistenceDTO, string> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const options: ISelectFieldOptionsDTO = {
      choices: field.selectOptions().map((option) => option.toDto()),
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
      ...(preventAutoNewOptions ? { preventAutoNewOptions } : {}),
    };

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'multipleSelect',
      options,
    });
  }

  visitCheckboxField(field: CheckboxField): Result<ITableFieldPersistenceDTO, string> {
    const options: ICheckboxFieldOptionsDTO = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toBoolean();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'checkbox',
      options,
    });
  }

  visitAttachmentField(field: AttachmentField): Result<ITableFieldPersistenceDTO, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'attachment',
      options: {},
    });
  }

  visitDateField(field: DateField): Result<ITableFieldPersistenceDTO, string> {
    const options: IDateFieldOptionsDTO = {
      formatting: field.formatting().toDto(),
    };
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'date',
      options,
    });
  }

  visitUserField(field: UserField): Result<ITableFieldPersistenceDTO, string> {
    const defaultValue = field.defaultValue();
    const options: IUserFieldOptionsDTO = {
      isMultiple: field.multiplicity().toBoolean(),
      shouldNotify: field.notification().toBoolean(),
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
    };

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'user',
      options,
    });
  }

  visitButtonField(field: ButtonField): Result<ITableFieldPersistenceDTO, string> {
    const maxCount = field.maxCount();
    const resetCount = field.resetCount();
    const workflow = field.workflow();
    const options: IButtonFieldOptionsDTO = {
      label: field.label().toString(),
      color: field.color().toString(),
      ...(maxCount ? { maxCount: maxCount.toNumber() } : {}),
      ...(resetCount ? { resetCount: resetCount.toBoolean() } : {}),
      ...(workflow ? { workflow: workflow.toDto() } : {}),
    };

    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'button',
      options,
    });
  }
}

const mapFieldToDto = (field: Field): Result<ITableFieldPersistenceDTO, string> =>
  field.accept(new FieldToPersistenceVisitor());

class ViewToPersistenceVisitor implements IViewVisitor<ITableViewPersistenceDTO> {
  visitGridView(view: GridView): Result<ITableViewPersistenceDTO, string> {
    return this.toDto(view, 'grid');
  }

  visitKanbanView(view: KanbanView): Result<ITableViewPersistenceDTO, string> {
    return this.toDto(view, 'kanban');
  }

  visitGalleryView(view: GalleryView): Result<ITableViewPersistenceDTO, string> {
    return this.toDto(view, 'gallery');
  }

  visitCalendarView(view: CalendarView): Result<ITableViewPersistenceDTO, string> {
    return this.toDto(view, 'calendar');
  }

  visitFormView(view: FormView): Result<ITableViewPersistenceDTO, string> {
    return this.toDto(view, 'form');
  }

  visitPluginView(view: PluginView): Result<ITableViewPersistenceDTO, string> {
    return this.toDto(view, 'plugin');
  }

  private toDto(
    view: View,
    type: ITableViewPersistenceDTO['type']
  ): Result<ITableViewPersistenceDTO, string> {
    return view.columnMeta().map((columnMeta) => ({
      id: view.id().toString(),
      name: view.name().toString(),
      type,
      columnMeta: columnMeta.toDto(),
    }));
  }
}

const mapViewToDto = (view: View): Result<ITableViewPersistenceDTO, string> =>
  view.accept(new ViewToPersistenceVisitor());

export class DefaultTableMapper implements ITableMapper {
  toDTO(table: Table): Result<ITablePersistenceDTO, string> {
    return sequenceResults(table.fields().map(mapFieldToDto)).andThen((fields) =>
      sequenceResults(table.views().map(mapViewToDto)).map((views) => ({
        id: table.id().toString(),
        baseId: table.baseId().toString(),
        name: table.name().toString(),
        primaryFieldId: table.primaryFieldId().toString(),
        fields: [...fields],
        views: [...views],
      }))
    );
  }

  toDomain(dto: ITablePersistenceDTO): Result<Table, string> {
    const idResult = TableId.create(dto.id);
    const baseIdResult = BaseId.create(dto.baseId);
    const nameResult = TableName.create(dto.name);
    const primaryFieldIdResult = FieldId.create(dto.primaryFieldId);

    const fieldsResult = sequenceResults(dto.fields.map((f) => this.mapFieldToDomain(f)));
    const viewsResult = sequenceResults(dto.views.map((v) => this.mapViewToDomain(v)));
    const dbTableNameResult = optional(dto.dbTableName, DbTableName.rehydrate);

    return idResult.andThen((id) =>
      baseIdResult.andThen((baseId) =>
        nameResult.andThen((name) =>
          primaryFieldIdResult.andThen((primaryFieldId) =>
            fieldsResult.andThen((fields) =>
              viewsResult.andThen((views) =>
                dbTableNameResult.andThen((dbTableName) => {
                  const props: ITableBuildProps = {
                    id,
                    baseId,
                    name,
                    primaryFieldId,
                    fields,
                    views,
                    ...(dbTableName ? { dbTableName } : {}),
                  };
                  return TableAggregate.rehydrate(props);
                })
              )
            )
          )
        )
      )
    );
  }

  private mapFieldToDomain(dto: ITableFieldPersistenceDTO): Result<Field, string> {
    return FieldId.create(dto.id)
      .andThen((id) =>
        FieldName.create(dto.name).andThen((name) => {
          return match(dto)
            .with({ type: 'singleLineText' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.showAs, SingleLineTextShowAs.create).andThen((showAs) =>
                optional(options.defaultValue, TextDefaultValue.create).andThen((defaultValue) =>
                  SingleLineTextField.create({ id, name, showAs, defaultValue })
                )
              );
            })
            .with({ type: 'longText' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.defaultValue, TextDefaultValue.create).andThen(
                (defaultValue) => LongTextField.create({ id, name, defaultValue })
              );
            })
            .with({ type: 'number' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.formatting, NumberFormatting.create).andThen((formatting) =>
                optional(options.showAs, NumberShowAs.create).andThen((showAs) =>
                  optional(options.defaultValue, NumberDefaultValue.create).andThen(
                    (defaultValue) =>
                      NumberField.create({ id, name, formatting, showAs, defaultValue })
                  )
                )
              );
            })
            .with({ type: 'rating' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.max, RatingMax.create).andThen((max) =>
                optional(options.icon, RatingIcon.create).andThen((icon) =>
                  optional(options.color, RatingColor.create).andThen((color) =>
                    RatingField.create({ id, name, max, icon, color })
                  )
                )
              );
            })
            .with({ type: 'formula' }, (dto) => {
              const options = dto.options;
              return FormulaExpression.create(options.expression).andThen((expression) =>
                optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
                  parseFormulaFormatting(options.formatting).andThen((formatting) =>
                    parseFormulaShowAs(options.showAs).andThen((showAs) =>
                      optional(dto.meta, FormulaMeta.rehydrate).andThen((meta) =>
                        parseFormulaResultType(dto.cellValueType, dto.isMultipleCellValue).andThen(
                          (resultType) =>
                            FormulaField.create({
                              id,
                              name,
                              expression,
                              timeZone,
                              formatting,
                              showAs,
                              meta,
                              ...(resultType ? { resultType } : {}),
                            })
                        )
                      )
                    )
                  )
                )
              );
            })
            .with({ type: 'singleSelect' }, (dto) => {
              const optionsDto = dto.options ?? { choices: [] };
              const choices = optionsDto.choices ?? [];
              return sequenceResults(choices.map((choice) => SelectOption.create(choice))).andThen(
                (options) =>
                  optional(optionsDto.defaultValue, SelectDefaultValue.create).andThen(
                    (defaultValue) =>
                      optional(
                        optionsDto.preventAutoNewOptions,
                        SelectAutoNewOptions.create
                      ).andThen((preventAutoNewOptions) =>
                        SingleSelectField.create({
                          id,
                          name,
                          options,
                          defaultValue,
                          preventAutoNewOptions,
                        })
                      )
                  )
              );
            })
            .with({ type: 'multipleSelect' }, (dto) => {
              const optionsDto = dto.options ?? { choices: [] };
              const choices = optionsDto.choices ?? [];
              return sequenceResults(choices.map((choice) => SelectOption.create(choice))).andThen(
                (options) =>
                  optional(optionsDto.defaultValue, SelectDefaultValue.create).andThen(
                    (defaultValue) =>
                      optional(
                        optionsDto.preventAutoNewOptions,
                        SelectAutoNewOptions.create
                      ).andThen((preventAutoNewOptions) =>
                        MultipleSelectField.create({
                          id,
                          name,
                          options,
                          defaultValue,
                          preventAutoNewOptions,
                        })
                      )
                  )
              );
            })
            .with({ type: 'checkbox' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.defaultValue, CheckboxDefaultValue.create).andThen(
                (defaultValue) => CheckboxField.create({ id, name, defaultValue })
              );
            })
            .with({ type: 'attachment' }, () => AttachmentField.create({ id, name }))
            .with({ type: 'date' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.formatting, DateTimeFormatting.create).andThen((formatting) =>
                optional(options.defaultValue, DateDefaultValue.create).andThen((defaultValue) =>
                  DateField.create({ id, name, formatting, defaultValue })
                )
              );
            })
            .with({ type: 'user' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.isMultiple, UserMultiplicity.create).andThen((isMultiple) =>
                optional(options.shouldNotify, UserNotification.create).andThen((shouldNotify) =>
                  optional(options.defaultValue, UserDefaultValue.create).andThen((defaultValue) =>
                    UserField.create({ id, name, isMultiple, shouldNotify, defaultValue })
                  )
                )
              );
            })
            .with({ type: 'button' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.label, ButtonLabel.create).andThen((label) =>
                optional(options.color, FieldColor.create).andThen((color) =>
                  optional(options.maxCount, ButtonMaxCount.create).andThen((maxCount) =>
                    optional(options.resetCount, ButtonResetCount.create).andThen((resetCount) =>
                      optional(options.workflow, ButtonWorkflow.create).andThen((workflow) =>
                        ButtonField.create({
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
            })
            .exhaustive();
        })
      )
      .andThen((field) => this.applyDbFieldName(field, dto.dbFieldName));
  }

  private mapViewToDomain(dto: ITableViewPersistenceDTO): Result<View, string> {
    return ViewId.create(dto.id).andThen((id) =>
      ViewName.create(dto.name).andThen((name) => {
        const viewResult = match(dto.type)
          .with('grid', () => GridView.create({ id, name }))
          .with('kanban', () => KanbanView.create({ id, name }))
          .with('gallery', () => GalleryView.create({ id, name }))
          .with('calendar', () => CalendarView.create({ id, name }))
          .with('form', () => FormView.create({ id, name }))
          .with('plugin', () => PluginView.create({ id, name }))
          .exhaustive();

        return viewResult.andThen((view) =>
          ViewColumnMeta.rehydrate(dto.columnMeta).andThen((columnMeta) =>
            view.setColumnMeta(columnMeta).map(() => view)
          )
        );
      })
    );
  }

  private applyDbFieldName(field: Field, dbFieldName: string | undefined): Result<Field, string> {
    if (!dbFieldName) return ok(field);
    return DbFieldName.rehydrate(dbFieldName).andThen((value) =>
      field.setDbFieldName(value).map(() => field)
    );
  }
}
