import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import { BaseId } from '../../../domain/base/BaseId';
import { domainError, type DomainError } from '../../../domain/shared/DomainError';
import { DbTableName } from '../../../domain/table/DbTableName';
import { DbFieldName } from '../../../domain/table/fields/DbFieldName';
import { DbFieldType } from '../../../domain/table/fields/DbFieldType';
import type { Field } from '../../../domain/table/fields/Field';
import { FieldId } from '../../../domain/table/fields/FieldId';
import { FieldName } from '../../../domain/table/fields/FieldName';
import { AttachmentField } from '../../../domain/table/fields/types/AttachmentField';
import { AutoNumberField } from '../../../domain/table/fields/types/AutoNumberField';
import { ButtonField } from '../../../domain/table/fields/types/ButtonField';
import { ButtonLabel } from '../../../domain/table/fields/types/ButtonLabel';
import { ButtonMaxCount } from '../../../domain/table/fields/types/ButtonMaxCount';
import { ButtonResetCount } from '../../../domain/table/fields/types/ButtonResetCount';
import { ButtonWorkflow } from '../../../domain/table/fields/types/ButtonWorkflow';
import { CellValueMultiplicity } from '../../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../../domain/table/fields/types/CellValueType';
import { CheckboxDefaultValue } from '../../../domain/table/fields/types/CheckboxDefaultValue';
import { CheckboxField } from '../../../domain/table/fields/types/CheckboxField';
import { ConditionalLookupField } from '../../../domain/table/fields/types/ConditionalLookupField';
import { ConditionalLookupOptions } from '../../../domain/table/fields/types/ConditionalLookupOptions';
import { ConditionalRollupConfig } from '../../../domain/table/fields/types/ConditionalRollupConfig';
import { ConditionalRollupField } from '../../../domain/table/fields/types/ConditionalRollupField';
import { CreatedByField } from '../../../domain/table/fields/types/CreatedByField';
import { CreatedTimeField } from '../../../domain/table/fields/types/CreatedTimeField';
import { DateDefaultValue } from '../../../domain/table/fields/types/DateDefaultValue';
import { DateField } from '../../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../../domain/table/fields/types/DateTimeFormatting';
import { FieldColor } from '../../../domain/table/fields/types/FieldColor';
import { FieldHasError } from '../../../domain/table/fields/types/FieldHasError';
import { FieldNotNull } from '../../../domain/table/fields/types/FieldNotNull';
import { FieldUnique } from '../../../domain/table/fields/types/FieldUnique';
import { FormulaExpression } from '../../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../../domain/table/fields/types/FormulaField';
import { FormulaMeta } from '../../../domain/table/fields/types/FormulaMeta';
import { GeneratedColumnMeta } from '../../../domain/table/fields/types/GeneratedColumnMeta';
import { LastModifiedByField } from '../../../domain/table/fields/types/LastModifiedByField';
import { LastModifiedTimeField } from '../../../domain/table/fields/types/LastModifiedTimeField';
import { LinkField } from '../../../domain/table/fields/types/LinkField';
import { LinkFieldConfig } from '../../../domain/table/fields/types/LinkFieldConfig';
import { LinkFieldMeta } from '../../../domain/table/fields/types/LinkFieldMeta';
import { LongTextField } from '../../../domain/table/fields/types/LongTextField';
import { LookupField } from '../../../domain/table/fields/types/LookupField';
import { LookupOptions } from '../../../domain/table/fields/types/LookupOptions';
import { MultipleSelectField } from '../../../domain/table/fields/types/MultipleSelectField';
import { NumberDefaultValue } from '../../../domain/table/fields/types/NumberDefaultValue';
import { NumberField } from '../../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../../domain/table/fields/types/NumberFormatting';
import { NumberShowAs } from '../../../domain/table/fields/types/NumberShowAs';
import { RatingColor } from '../../../domain/table/fields/types/RatingColor';
import { RatingField } from '../../../domain/table/fields/types/RatingField';
import { RatingIcon } from '../../../domain/table/fields/types/RatingIcon';
import { RatingMax } from '../../../domain/table/fields/types/RatingMax';
import { RollupExpression } from '../../../domain/table/fields/types/RollupExpression';
import { RollupField } from '../../../domain/table/fields/types/RollupField';
import { RollupFieldConfig } from '../../../domain/table/fields/types/RollupFieldConfig';
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
import { ViewQueryDefaults } from '../../../domain/table/views/ViewQueryDefaults';
import type { IViewVisitor } from '../../../domain/table/views/visitors/IViewVisitor';
import type {
  IAutoNumberFieldOptionsDTO,
  IButtonFieldOptionsDTO,
  ICheckboxFieldOptionsDTO,
  IConditionalLookupOptionsDTO,
  IConditionalRollupFieldConfigDTO,
  IConditionalRollupFieldOptionsDTO,
  ICreatedByFieldOptionsDTO,
  ICreatedTimeFieldOptionsDTO,
  IDateFieldOptionsDTO,
  IFormulaFieldMetaDTO,
  IFormulaFieldOptionsDTO,
  IGeneratedColumnMetaDTO,
  ILastModifiedByFieldOptionsDTO,
  ILastModifiedTimeFieldOptionsDTO,
  ILinkFieldMetaDTO,
  ILinkFieldOptionsDTO,
  ILongTextFieldOptionsDTO,
  ILookupOptionsDTO,
  INumberFieldOptionsDTO,
  IRatingFieldOptionsDTO,
  IRollupFieldConfigDTO,
  IRollupFieldOptionsDTO,
  ISelectFieldOptionsDTO,
  ISingleLineTextFieldOptionsDTO,
  IUserFieldOptionsDTO,
  ITableFieldPersistenceDTO,
  ITableMapper,
  ITablePersistenceDTO,
  ITableViewPersistenceDTO,
} from '../TableMapper';

const sequenceResults = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<ReadonlyArray<T>, DomainError> =>
  values.reduce<Result<ReadonlyArray<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

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

const parseFormulaResultType = (
  cellValueTypeRaw: unknown,
  isMultipleCellValueRaw: unknown
): Result<
  { cellValueType: CellValueType; isMultipleCellValue: CellValueMultiplicity } | undefined,
  DomainError
> => {
  // If cellValueType is not set, we cannot determine the result type
  if (cellValueTypeRaw == null) {
    return ok(undefined);
  }
  // Default to single value (false) if isMultipleCellValue is not a boolean
  // This handles cases where older formula fields may have null/undefined for this column
  const isMultiple = typeof isMultipleCellValueRaw === 'boolean' ? isMultipleCellValueRaw : false;
  return CellValueType.create(cellValueTypeRaw).andThen((cellValueType) =>
    CellValueMultiplicity.create(isMultiple).map((isMultipleCellValue) => ({
      cellValueType,
      isMultipleCellValue,
    }))
  );
};

const parseTrackedFieldIds = (raw: unknown): Result<ReadonlyArray<FieldId>, DomainError> => {
  if (raw == null) return ok([]);
  if (!Array.isArray(raw))
    return err(domainError.validation({ message: 'Invalid trackedFieldIds' }));
  return sequenceResults(raw.map((entry) => FieldId.create(entry)));
};

class FieldToPersistenceVisitor implements IFieldVisitor<ITableFieldPersistenceDTO> {
  private baseField(field: Field): {
    id: string;
    name: string;
    dbFieldType?: string;
    notNull?: boolean;
    unique?: boolean;
    isComputed?: boolean;
  } {
    const notNull = field.notNull().toBoolean();
    const unique = field.unique().toBoolean();
    const isComputed = field.computed().toBoolean();
    const dbFieldTypeResult = field.dbFieldType().andThen((type) => type.value());

    return {
      id: field.id().toString(),
      name: field.name().toString(),
      ...(dbFieldTypeResult.isOk() ? { dbFieldType: dbFieldTypeResult.value } : {}),
      ...(notNull ? { notNull } : {}),
      ...(unique ? { unique } : {}),
      ...(isComputed ? { isComputed } : {}),
    };
  }

  visitSingleLineTextField(
    field: SingleLineTextField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: ISingleLineTextFieldOptionsDTO = {};
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      ...this.baseField(field),
      type: 'singleLineText',
      options,
    });
  }

  visitLongTextField(field: LongTextField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: ILongTextFieldOptionsDTO = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      ...this.baseField(field),
      type: 'longText',
      options,
    });
  }

  visitNumberField(field: NumberField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: INumberFieldOptionsDTO = {
      formatting: field.formatting().toDto(),
    };
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toNumber();

    return ok({
      ...this.baseField(field),
      type: 'number',
      options,
    });
  }

  visitRatingField(field: RatingField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: IRatingFieldOptionsDTO = {
      icon: field.ratingIcon().toString(),
      color: field.ratingColor().toString(),
      max: field.ratingMax().toNumber(),
    };

    return ok({
      ...this.baseField(field),
      type: 'rating',
      options,
    });
  }

  visitFormulaField(field: FormulaField): Result<ITableFieldPersistenceDTO, DomainError> {
    const expression = field.expression().toString();
    const options: IFormulaFieldOptionsDTO = { expression };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const meta = field.meta();
    const base = {
      ...this.baseField(field),
      type: 'formula' as const,
      options,
    };

    const resultType = field.cellValueType().andThen((cellValueType) =>
      field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
    if (resultType.isErr()) {
      return (meta ? meta.toDto() : ok(undefined)).map((metaDto) => ({
        ...base,
        ...(metaDto ? { meta: metaDto as IFormulaFieldMetaDTO } : {}),
      }));
    }
    return (meta ? meta.toDto() : ok(undefined)).map((metaDto) => ({
      ...base,
      ...(metaDto ? { meta: metaDto as IFormulaFieldMetaDTO } : {}),
      cellValueType: resultType.value.cellValueType.toString(),
      isMultipleCellValue: resultType.value.isMultipleCellValue.toBoolean(),
    }));
  }

  visitRollupField(field: RollupField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: IRollupFieldOptionsDTO = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const config: IRollupFieldConfigDTO = field.configDto();
    const base = {
      ...this.baseField(field),
      type: 'rollup' as const,
      options,
      config,
    };
    const resultType = field.cellValueType().andThen((cellValueType) =>
      field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
    if (resultType.isErr()) {
      return ok(base);
    }
    return ok({
      ...base,
      cellValueType: resultType.value.cellValueType.toString(),
      isMultipleCellValue: resultType.value.isMultipleCellValue.toBoolean(),
    });
  }

  visitSingleSelectField(field: SingleSelectField): Result<ITableFieldPersistenceDTO, DomainError> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const options: ISelectFieldOptionsDTO = {
      choices: field.selectOptions().map((option) => option.toDto()),
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
      ...(preventAutoNewOptions ? { preventAutoNewOptions } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'singleSelect',
      options,
    });
  }

  visitMultipleSelectField(
    field: MultipleSelectField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const options: ISelectFieldOptionsDTO = {
      choices: field.selectOptions().map((option) => option.toDto()),
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
      ...(preventAutoNewOptions ? { preventAutoNewOptions } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'multipleSelect',
      options,
    });
  }

  visitCheckboxField(field: CheckboxField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: ICheckboxFieldOptionsDTO = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toBoolean();

    return ok({
      ...this.baseField(field),
      type: 'checkbox',
      options,
    });
  }

  visitAttachmentField(field: AttachmentField): Result<ITableFieldPersistenceDTO, DomainError> {
    return ok({
      ...this.baseField(field),
      type: 'attachment',
      options: {},
    });
  }

  visitDateField(field: DateField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: IDateFieldOptionsDTO = {
      formatting: field.formatting().toDto(),
    };
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();

    return ok({
      ...this.baseField(field),
      type: 'date',
      options,
    });
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: ICreatedTimeFieldOptionsDTO = {
      expression: field.expression().toString(),
      formatting: field.formatting().toDto(),
    };
    const meta = field.meta();

    return meta.toDto().map((metaDto) => ({
      ...this.baseField(field),
      type: 'createdTime',
      options,
      ...(metaDto ? { meta: metaDto as IGeneratedColumnMetaDTO } : {}),
    }));
  }

  visitLastModifiedTimeField(
    field: LastModifiedTimeField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const trackedFieldIds = field.trackedFieldIds().map((id) => id.toString());
    const options: ILastModifiedTimeFieldOptionsDTO = {
      expression: field.expression().toString(),
      formatting: field.formatting().toDto(),
      ...(trackedFieldIds.length > 0 ? { trackedFieldIds } : {}),
    };
    const meta = field.meta();

    return meta.toDto().map((metaDto) => ({
      ...this.baseField(field),
      type: 'lastModifiedTime',
      options,
      ...(metaDto ? { meta: metaDto as IGeneratedColumnMetaDTO } : {}),
    }));
  }

  visitUserField(field: UserField): Result<ITableFieldPersistenceDTO, DomainError> {
    const defaultValue = field.defaultValue();
    const options: IUserFieldOptionsDTO = {
      isMultiple: field.multiplicity().toBoolean(),
      shouldNotify: field.notification().toBoolean(),
      ...(defaultValue ? { defaultValue: defaultValue.toDto() } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'user',
      options,
    });
  }

  visitCreatedByField(field: CreatedByField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: ICreatedByFieldOptionsDTO = {};
    const meta = field.meta();
    return meta.toDto().map((metaDto) => ({
      ...this.baseField(field),
      type: 'createdBy',
      options,
      ...(metaDto ? { meta: metaDto as IGeneratedColumnMetaDTO } : {}),
    }));
  }

  visitLastModifiedByField(
    field: LastModifiedByField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const trackedFieldIds = field.trackedFieldIds().map((id) => id.toString());
    const options: ILastModifiedByFieldOptionsDTO = {
      ...(trackedFieldIds.length > 0 ? { trackedFieldIds } : {}),
    };
    const meta = field.meta();

    return meta.toDto().map((metaDto) => ({
      ...this.baseField(field),
      type: 'lastModifiedBy',
      options,
      ...(metaDto ? { meta: metaDto as IGeneratedColumnMetaDTO } : {}),
    }));
  }

  visitAutoNumberField(field: AutoNumberField): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: IAutoNumberFieldOptionsDTO = {
      expression: field.expression().toString(),
    };
    const meta = field.meta();
    return meta.toDto().map((metaDto) => ({
      ...this.baseField(field),
      type: 'autoNumber',
      options,
      ...(metaDto ? { meta: metaDto as IGeneratedColumnMetaDTO } : {}),
    }));
  }

  visitButtonField(field: ButtonField): Result<ITableFieldPersistenceDTO, DomainError> {
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
      ...this.baseField(field),
      type: 'button',
      options,
    });
  }

  visitLinkField(field: LinkField): Result<ITableFieldPersistenceDTO, DomainError> {
    const optionsResult = field.configDto();
    if (optionsResult.isErr()) return err(optionsResult.error);
    const meta = field.metaDto();
    return ok({
      ...this.baseField(field),
      type: 'link',
      options: optionsResult.value,
      ...(meta ? { meta } : {}),
    });
  }

  /**
   * LookupField is persisted using the v1 format:
   * - type: the inner field's type (e.g., 'number', 'singleLineText')
   * - isLookup: true
   * - isConditionalLookup: boolean (when lookup uses conditional filtering)
   * - lookupOptions: { linkFieldId, lookupFieldId, foreignTableId }
   * - options: the inner field's options
   */
  visitLookupField(field: LookupField): Result<ITableFieldPersistenceDTO, DomainError> {
    const baseDto = this.baseField(field);
    const lookupOptions = field.lookupOptionsDto() as ILookupOptionsDTO;
    // TODO: Add conditional lookup support to LookupOptions when needed
    const isConditionalLookup = false;

    // For pending lookup fields (inner field not yet resolved), use singleLineText as default type
    if (field.isPending()) {
      return ok({
        ...baseDto,
        type: 'singleLineText' as const,
        isLookup: true,
        isConditionalLookup,
        lookupOptions,
        isComputed: true,
      });
    }

    // Get the inner field's DTO representation
    return field
      .innerField()
      .andThen((inner) => inner.accept(this))
      .map((innerDto: ITableFieldPersistenceDTO) => ({
        ...innerDto,
        id: field.id().toString(),
        name: field.name().toString(),
        isLookup: true,
        isConditionalLookup,
        lookupOptions,
        isComputed: true,
      }));
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const options: IConditionalRollupFieldOptionsDTO = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const config: IConditionalRollupFieldConfigDTO =
      field.configDto() as IConditionalRollupFieldConfigDTO;
    const base = {
      ...this.baseField(field),
      type: 'conditionalRollup' as const,
      options,
      config,
    };
    const resultType = field.cellValueType().andThen((cellValueType) =>
      field.isMultipleCellValue().map((isMultipleCellValue) => ({
        cellValueType,
        isMultipleCellValue,
      }))
    );
    if (resultType.isErr()) {
      return ok(base);
    }
    return ok({
      ...base,
      cellValueType: resultType.value.cellValueType.toString(),
      isMultipleCellValue: resultType.value.isMultipleCellValue.toBoolean(),
    });
  }

  /**
   * ConditionalLookupField is persisted with its own type 'conditionalLookup'.
   * The inner field type and options are stored for value type resolution.
   */
  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const baseDto = this.baseField(field);
    const options: IConditionalLookupOptionsDTO =
      field.conditionalLookupOptionsDto() as IConditionalLookupOptionsDTO;

    // For pending conditional lookup fields (inner field not yet resolved)
    if (field.isPending()) {
      return ok({
        ...baseDto,
        type: 'conditionalLookup' as const,
        options,
        isComputed: true,
      });
    }

    // Get inner field info for value type resolution
    return field.innerField().andThen((inner) =>
      inner.accept(this).map((innerDto: ITableFieldPersistenceDTO) => ({
        ...baseDto,
        type: 'conditionalLookup' as const,
        options,
        innerType: innerDto.type,
        innerOptions: 'options' in innerDto ? innerDto.options : undefined,
        isComputed: true,
      }))
    );
  }
}

const mapFieldToDto = (field: Field): Result<ITableFieldPersistenceDTO, DomainError> =>
  field.accept(new FieldToPersistenceVisitor());

class ViewToPersistenceVisitor implements IViewVisitor<ITableViewPersistenceDTO> {
  visitGridView(view: GridView): Result<ITableViewPersistenceDTO, DomainError> {
    return this.toDto(view, 'grid');
  }

  visitKanbanView(view: KanbanView): Result<ITableViewPersistenceDTO, DomainError> {
    return this.toDto(view, 'kanban');
  }

  visitGalleryView(view: GalleryView): Result<ITableViewPersistenceDTO, DomainError> {
    return this.toDto(view, 'gallery');
  }

  visitCalendarView(view: CalendarView): Result<ITableViewPersistenceDTO, DomainError> {
    return this.toDto(view, 'calendar');
  }

  visitFormView(view: FormView): Result<ITableViewPersistenceDTO, DomainError> {
    return this.toDto(view, 'form');
  }

  visitPluginView(view: PluginView): Result<ITableViewPersistenceDTO, DomainError> {
    return this.toDto(view, 'plugin');
  }

  private toDto(
    view: View,
    type: ITableViewPersistenceDTO['type']
  ): Result<ITableViewPersistenceDTO, DomainError> {
    return view.columnMeta().andThen((columnMeta) =>
      view.queryDefaults().map((queryDefaults) => ({
        id: view.id().toString(),
        name: view.name().toString(),
        type,
        columnMeta: columnMeta.toDto(),
        query: queryDefaults.toDto(),
      }))
    );
  }
}

const mapViewToDto = (view: View): Result<ITableViewPersistenceDTO, DomainError> =>
  view.accept(new ViewToPersistenceVisitor());

export class DefaultTableMapper implements ITableMapper {
  toDTO(table: Table): Result<ITablePersistenceDTO, DomainError> {
    return sequenceResults(table.getFields().map(mapFieldToDto)).andThen((fields) =>
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

  toDomain(dto: ITablePersistenceDTO): Result<Table, DomainError> {
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

  private mapFieldToDomain(dto: ITableFieldPersistenceDTO): Result<Field, DomainError> {
    // Check if this is a lookup field (v1 format: isLookup flag on the field)
    if (dto.isLookup && dto.lookupOptions) {
      return this.mapLookupFieldToDomain(dto);
    }

    return this.mapBaseFieldToDomain(dto);
  }

  /**
   * Maps a lookup field from v1 DTO format to LookupField domain entity.
   * The inner field is created from the DTO's type and options.
   */
  private mapLookupFieldToDomain(dto: ITableFieldPersistenceDTO): Result<Field, DomainError> {
    const lookupOptionsRaw = dto.lookupOptions;
    if (!lookupOptionsRaw) {
      return err(domainError.unexpected({ message: 'Lookup field requires lookupOptions' }));
    }

    const dbFieldType = this.resolveLookupDbFieldType(dto);

    return FieldId.create(dto.id).andThen((id) =>
      FieldName.create(dto.name).andThen((name) =>
        LookupOptions.create(lookupOptionsRaw).andThen((lookupOptions) =>
          FieldId.generate().andThen((innerId) =>
            this.mapBaseFieldToDomain({
              ...dto,
              isLookup: undefined,
              lookupOptions: undefined,
              // Use a valid generated id for inner field (it's not persisted separately)
              id: innerId.toString(),
            }).andThen((innerField) =>
              LookupField.create({
                id,
                name,
                innerField,
                lookupOptions,
                isMultipleCellValue: dto.isMultipleCellValue,
              }).andThen((field) =>
                this.applyDbFieldName(field, dto.dbFieldName)
                  .andThen((updated) => this.applyDbFieldType(updated, dbFieldType))
                  .andThen((updated) => this.applyHasError(updated, dto.hasError))
                  .map((updated) => updated as Field)
              )
            )
          )
        )
      )
    );
  }

  private mapBaseFieldToDomain(dto: ITableFieldPersistenceDTO): Result<Field, DomainError> {
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
            .with({ type: 'rollup' }, (dto) => {
              const options = dto.options;
              const configRaw = dto.config;
              if (!configRaw)
                return err(domainError.validation({ message: 'RollupField config is required' }));
              return RollupFieldConfig.create(configRaw).andThen((config) =>
                RollupExpression.create(options.expression).andThen((expression) =>
                  optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
                    parseFormulaFormatting(options.formatting).andThen((formatting) =>
                      parseFormulaShowAs(options.showAs).andThen((showAs) =>
                        parseFormulaResultType(dto.cellValueType, dto.isMultipleCellValue).andThen(
                          (resultType) =>
                            resultType
                              ? RollupField.rehydrate({
                                  id,
                                  name,
                                  config,
                                  expression,
                                  timeZone,
                                  formatting,
                                  showAs,
                                  resultType,
                                })
                              : RollupField.createPending({
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
            .with({ type: 'createdTime' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.formatting, DateTimeFormatting.create).andThen((formatting) =>
                GeneratedColumnMeta.rehydrate(dto.meta ?? {}).andThen((meta) =>
                  CreatedTimeField.create({ id, name, formatting, meta })
                )
              );
            })
            .with({ type: 'lastModifiedTime' }, (dto) => {
              const options = dto.options ?? {};
              return optional(options.formatting, DateTimeFormatting.create).andThen((formatting) =>
                parseTrackedFieldIds(options.trackedFieldIds).andThen((trackedFieldIds) =>
                  GeneratedColumnMeta.rehydrate(dto.meta ?? {}).andThen((meta) =>
                    LastModifiedTimeField.create({
                      id,
                      name,
                      formatting,
                      trackedFieldIds,
                      meta,
                    })
                  )
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
            .with({ type: 'createdBy' }, (dto) =>
              GeneratedColumnMeta.rehydrate(dto.meta ?? {}).andThen((meta) =>
                CreatedByField.create({ id, name, meta })
              )
            )
            .with({ type: 'lastModifiedBy' }, (dto) => {
              const options = dto.options ?? {};
              return parseTrackedFieldIds(options.trackedFieldIds).andThen((trackedFieldIds) =>
                GeneratedColumnMeta.rehydrate(dto.meta ?? {}).andThen((meta) =>
                  LastModifiedByField.create({ id, name, trackedFieldIds, meta })
                )
              );
            })
            .with({ type: 'autoNumber' }, (dto) =>
              GeneratedColumnMeta.rehydrate(dto.meta ?? {}).andThen((meta) =>
                AutoNumberField.create({ id, name, meta })
              )
            )
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
            .with({ type: 'link' }, (dto) =>
              LinkFieldConfig.create(dto.options as ILinkFieldOptionsDTO).andThen((config) =>
                LinkFieldMeta.create(dto.meta as ILinkFieldMetaDTO | undefined).andThen((meta) =>
                  LinkField.create({ id, name, config, meta })
                )
              )
            )
            .with({ type: 'conditionalRollup' }, (dto) => {
              const options = dto.options;
              const configRaw = dto.config;
              return ConditionalRollupConfig.create(configRaw).andThen((config) =>
                RollupExpression.create(options.expression).andThen((expression) =>
                  optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
                    parseFormulaFormatting(options.formatting).andThen((formatting) =>
                      parseFormulaShowAs(options.showAs).andThen((showAs) =>
                        parseFormulaResultType(dto.cellValueType, dto.isMultipleCellValue).andThen(
                          (resultType) =>
                            resultType
                              ? ConditionalRollupField.rehydrate({
                                  id,
                                  name,
                                  config,
                                  expression,
                                  timeZone,
                                  formatting,
                                  showAs,
                                  resultType,
                                })
                              : ConditionalRollupField.createPending({
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
                )
              );
            })
            .with({ type: 'conditionalLookup' }, (dto) => {
              const options = dto.options;
              return ConditionalLookupOptions.create(options).andThen((conditionalLookupOptions) =>
                ConditionalLookupField.createPending({
                  id,
                  name,
                  conditionalLookupOptions,
                  isMultipleCellValue: dto.isMultipleCellValue,
                })
              );
            })
            .exhaustive();
        })
      )
      .andThen((field) => this.applyFieldValidation(field, dto.notNull, dto.unique))
      .andThen((field) => this.applyDbFieldName(field, dto.dbFieldName))
      .andThen((field) => this.applyDbFieldType(field, dto.dbFieldType))
      .andThen((field) => this.applyHasError(field, dto.hasError));
  }

  private mapViewToDomain(dto: ITableViewPersistenceDTO): Result<View, DomainError> {
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
            view
              .setColumnMeta(columnMeta)
              .andThen(() => ViewQueryDefaults.rehydrate(dto.query ?? {}))
              .andThen((queryDefaults) => view.setQueryDefaults(queryDefaults))
              .map(() => view)
          )
        );
      })
    );
  }

  private applyDbFieldName(
    field: Field,
    dbFieldName: string | undefined
  ): Result<Field, DomainError> {
    if (!dbFieldName) return ok(field);
    return DbFieldName.rehydrate(dbFieldName).andThen((value) =>
      field.setDbFieldName(value).map(() => field)
    );
  }

  private applyDbFieldType(
    field: Field,
    dbFieldType: string | undefined
  ): Result<Field, DomainError> {
    if (!dbFieldType) return ok(field);
    return DbFieldType.rehydrate(dbFieldType).andThen((value) =>
      field.setDbFieldType(value).map(() => field)
    );
  }

  private resolveLookupDbFieldType(dto: ITableFieldPersistenceDTO): string | undefined {
    if (!dto.isLookup) return dto.dbFieldType;
    const normalized = dto.dbFieldType?.trim().toUpperCase();
    const isJsonLike =
      !normalized || normalized === 'JSON' || normalized === 'JSONB' || normalized === 'JSON[]';
    if (!isJsonLike) return dto.dbFieldType;
    if (dto.type === 'createdBy' || dto.type === 'lastModifiedBy') {
      return 'JSON';
    }
    if (
      (dto.type === 'createdTime' || dto.type === 'lastModifiedTime') &&
      dto.isMultipleCellValue === true
    ) {
      return 'JSON';
    }
    switch (dto.type) {
      case 'autoNumber':
        return 'INTEGER';
      case 'createdTime':
      case 'lastModifiedTime':
        return 'DATETIME';
      default:
        return dto.dbFieldType;
    }
  }

  private applyHasError(field: Field, hasError: boolean | undefined): Result<Field, DomainError> {
    field.setHasError(FieldHasError.from(hasError));
    return ok(field);
  }

  private applyFieldValidation(
    field: Field,
    notNullRaw: boolean | undefined,
    uniqueRaw: boolean | undefined
  ): Result<Field, DomainError> {
    const notNullResult =
      typeof notNullRaw === 'boolean'
        ? FieldNotNull.create(notNullRaw)
        : ok(FieldNotNull.optional());
    const uniqueResult =
      typeof uniqueRaw === 'boolean' ? FieldUnique.create(uniqueRaw) : ok(FieldUnique.disabled());

    return notNullResult.andThen((notNull) =>
      uniqueResult
        .andThen((unique) => field.setNotNull(notNull).andThen(() => field.setUnique(unique)))
        .map(() => field)
    );
  }
}
