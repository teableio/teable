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
import {
  extractLookupDisplayOptionsPatch,
  toRegularLookupFormulaOptions,
} from '../../../domain/table/fields/lookupFormulaOptions';
import { AttachmentField } from '../../../domain/table/fields/types/AttachmentField';
import { AutoNumberField } from '../../../domain/table/fields/types/AutoNumberField';
import { ButtonConfirm } from '../../../domain/table/fields/types/ButtonConfirm';
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
import { LongTextShowAs } from '../../../domain/table/fields/types/LongTextShowAs';
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
import { FieldValueTypeVisitor } from '../../../domain/table/fields/visitors/FieldValueTypeVisitor';
import type { IFieldVisitor } from '../../../domain/table/fields/visitors/IFieldVisitor';
import type { Table } from '../../../domain/table/Table';
import { Table as TableAggregate } from '../../../domain/table/Table';
import type { ITableBuildProps } from '../../../domain/table/TableBuilder';
import { TableId } from '../../../domain/table/TableId';
import { TableName } from '../../../domain/table/TableName';
import { TableProperties } from '../../../domain/table/TableProperties';
import type { CalendarView } from '../../../domain/table/views/types/CalendarView';
import type { FormView } from '../../../domain/table/views/types/FormView';
import type { GalleryView } from '../../../domain/table/views/types/GalleryView';
import type { GridView } from '../../../domain/table/views/types/GridView';
import type { KanbanView } from '../../../domain/table/views/types/KanbanView';
import type { PluginView } from '../../../domain/table/views/types/PluginView';
import type { View } from '../../../domain/table/views/View';
import { ViewAuditMetadata } from '../../../domain/table/views/ViewAuditMetadata';
import { ViewColumnMeta } from '../../../domain/table/views/ViewColumnMeta';
import { createView } from '../../../domain/table/views/ViewFactory';
import { ViewId } from '../../../domain/table/views/ViewId';
import { ViewName } from '../../../domain/table/views/ViewName';
import { ViewOrder } from '../../../domain/table/views/ViewOrder';
import { ViewProperties } from '../../../domain/table/views/ViewProperties';
import { ViewQueryDefaults } from '../../../domain/table/views/ViewQueryDefaults';
import { ViewVersion } from '../../../domain/table/views/ViewVersion';
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
  ISelectFieldChoiceDTO,
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
): Result<ReadonlyArray<T>, DomainError> => {
  const result: T[] = [];
  for (const value of values) {
    if (value.isErr()) return err<ReadonlyArray<T>, DomainError>(value.error);
    result.push(value.value);
  }
  return ok(result);
};

const optional = <T>(
  raw: unknown,
  parser: (value: unknown) => Result<T, DomainError>
): Result<T | undefined, DomainError> => {
  if (raw == null) return ok(undefined);
  return parser(raw).map((value) => value);
};

const lookupOptionsToRollupConfig = (lookupOptions: ILookupOptionsDTO): IRollupFieldConfigDTO => ({
  linkFieldId: lookupOptions.linkFieldId,
  foreignTableId: lookupOptions.foreignTableId,
  lookupFieldId: lookupOptions.lookupFieldId,
  ...(lookupOptions.filter !== undefined ? { filter: lookupOptions.filter } : {}),
  ...(lookupOptions.sort !== undefined ? { sort: lookupOptions.sort } : {}),
  ...(typeof lookupOptions.limit === 'number' ? { limit: lookupOptions.limit } : {}),
});

const canDegradeBrokenLookupInner = (type: ITableFieldPersistenceDTO['type']): boolean =>
  type === 'link' || type === 'rollup';

const deduplicateSelectChoiceDtos = (
  choices: ReadonlyArray<ISelectFieldChoiceDTO>
): ReadonlyArray<ISelectFieldChoiceDTO> => {
  const seen = new Set<string>();
  const deduped: ISelectFieldChoiceDTO[] = [];
  for (const choice of choices) {
    const name = choice.name.trim();
    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(choice);
  }
  return deduped;
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

const unwrapConditionalLookupInner = (
  dto: ITableFieldPersistenceDTO
): { innerType?: ITableFieldPersistenceDTO['type']; innerOptions?: unknown } => {
  if (dto.type !== 'conditionalLookup') {
    return {
      innerType: dto.type,
      innerOptions: 'options' in dto ? dto.options : undefined,
    };
  }

  if (dto.innerType && dto.innerType !== 'conditionalLookup') {
    return {
      innerType: dto.innerType as ITableFieldPersistenceDTO['type'],
      innerOptions: dto.innerOptions,
    };
  }

  return {
    innerType: undefined,
    innerOptions: undefined,
  };
};

const mergeLookupInnerOptions = (params: {
  innerOptions?: unknown;
  innerOptionsPatch?: Readonly<Record<string, unknown>>;
  innerType?: string;
  normalizeRegularLookupFormulaOptions?: boolean;
}): ITableFieldPersistenceDTO['options'] | undefined => {
  const baseInnerOptions =
    params.innerOptions &&
    typeof params.innerOptions === 'object' &&
    !Array.isArray(params.innerOptions)
      ? ({ ...(params.innerOptions as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;
  const innerOptionsPatch = params.innerOptionsPatch;

  const merged: Record<string, unknown> | undefined =
    !innerOptionsPatch || Object.keys(innerOptionsPatch).length === 0
      ? baseInnerOptions
      : {
          ...(baseInnerOptions ?? {}),
          ...innerOptionsPatch,
        };

  // Regular lookup-of-formula: force parseable placeholder expression, never foreign refs.
  if (params.normalizeRegularLookupFormulaOptions && params.innerType === 'formula') {
    return toRegularLookupFormulaOptions(merged) as IFormulaFieldOptionsDTO;
  }
  return merged as ITableFieldPersistenceDTO['options'] | undefined;
};

class FieldToPersistenceVisitor implements IFieldVisitor<ITableFieldPersistenceDTO> {
  constructor(
    private readonly resolveLookupRelationship?: (
      linkFieldId: string
    ) => ILinkFieldOptionsDTO['relationship'] | undefined,
    private readonly resolveLinkFieldOptions?: (
      linkFieldId: string
    ) => ILinkFieldOptionsDTO | undefined
  ) {}

  private baseField(field: Field): {
    id: string;
    name: string;
    description?: string | null;
    aiConfig?: unknown | null;
    dbFieldName?: string;
    dbFieldType?: string;
    notNull?: boolean;
    unique?: boolean;
    isComputed?: boolean;
    hasError?: boolean;
  } {
    const notNull = field.notNull().toBoolean();
    const unique = field.unique().toBoolean();
    const isComputed = field.computed().toBoolean();
    const hasError = field.hasError().isError();
    const dbFieldTypeResult = field.dbFieldType().andThen((type) => type.value());
    const dbFieldNameResult = field.dbFieldName().andThen((name) => name.value());

    return {
      id: field.id().toString(),
      name: field.name().toString(),
      ...(field.description() != null ? { description: field.description() } : {}),
      ...(field.aiConfig() !== undefined ? { aiConfig: field.aiConfig() } : {}),
      ...(dbFieldNameResult.isOk() ? { dbFieldName: dbFieldNameResult.value } : {}),
      ...(dbFieldTypeResult.isOk() ? { dbFieldType: dbFieldTypeResult.value } : {}),
      ...(notNull ? { notNull } : {}),
      unique,
      ...(isComputed ? { isComputed } : {}),
      ...(hasError ? { hasError } : {}),
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
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
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
    const confirm = field.confirm();
    const options: IButtonFieldOptionsDTO = {
      label: field.label().toString(),
      color: field.color().toString(),
      ...(maxCount ? { maxCount: maxCount.toNumber() } : {}),
      ...(resetCount ? { resetCount: resetCount.toBoolean() } : {}),
      ...(workflow ? { workflow: workflow.toDto() } : {}),
      ...(confirm ? { confirm: confirm.toDto() } : {}),
    };

    return ok({
      ...this.baseField(field),
      type: 'button',
      options,
    });
  }

  private mapLinkFieldOptions(field: LinkField): ILinkFieldOptionsDTO {
    const config = field.config();
    return {
      ...(config.baseId() ? { baseId: config.baseId()!.toString() } : {}),
      relationship: config.relationship().toString(),
      foreignTableId: config.foreignTableId().toString(),
      lookupFieldId: config.lookupFieldId().toString(),
      ...(config.isOneWay() ? { isOneWay: true } : {}),
      ...(config.symmetricFieldId()
        ? { symmetricFieldId: config.symmetricFieldId()!.toString() }
        : {}),
      ...(config.filterByViewId() === null
        ? { filterByViewId: null }
        : config.filterByViewId()
          ? { filterByViewId: config.filterByViewId()!.toString() }
          : {}),
      ...(config.visibleFieldIds() === null
        ? { visibleFieldIds: null }
        : config.visibleFieldIds()
          ? { visibleFieldIds: config.visibleFieldIds()!.map((id) => id.toString()) }
          : {}),
      ...(config.filter() !== undefined ? { filter: config.filter() } : {}),
    };
  }

  /**
   * Pick ONLY the parent link's stable physical join metadata. The client's fieldVoSchema requires
   * these three keys on a lookup's lookupOptions to resolve the join.
   *
   * We deliberately exclude the link's mutable record-scoping config (filter / filterByViewId /
   * visibleFieldIds / baseId / isOneWay): copying those into the lookup would bake in a write-time
   * snapshot that goes stale when the link changes, and the client does not need them for a lookup.
   */
  private pickLinkJoinMetadata(
    linkOptions: ILinkFieldOptionsDTO
  ): Partial<Pick<ILinkFieldOptionsDTO, 'fkHostTableName' | 'selfKeyName' | 'foreignKeyName'>> {
    const result: Partial<
      Pick<ILinkFieldOptionsDTO, 'fkHostTableName' | 'selfKeyName' | 'foreignKeyName'>
    > = {};
    if (linkOptions.fkHostTableName != null) result.fkHostTableName = linkOptions.fkHostTableName;
    if (linkOptions.selfKeyName != null) result.selfKeyName = linkOptions.selfKeyName;
    if (linkOptions.foreignKeyName != null) result.foreignKeyName = linkOptions.foreignKeyName;
    return result;
  }

  visitLinkField(field: LinkField): Result<ITableFieldPersistenceDTO, DomainError> {
    const optionsResult = field.configDto().orElse(() => ok(this.mapLinkFieldOptions(field)));
    if (optionsResult.isErr()) {
      return err(optionsResult.error);
    }
    const meta = field.metaDto();
    const base = {
      ...this.baseField(field),
      type: 'link',
      options: optionsResult.value,
      ...(meta ? { meta } : {}),
    } as const;

    const resultType = field.accept(new FieldValueTypeVisitor());
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

    // Resolve isMultipleCellValue from the field's cell value multiplicity
    const multiplicityResult = field.isMultipleCellValue();
    const isMultipleCellValue = multiplicityResult.isOk()
      ? multiplicityResult.value.toBoolean()
      : undefined;
    const resolvedRelationship = this.resolveLookupRelationship?.(lookupOptions.linkFieldId);
    const fallbackRelationship =
      isMultipleCellValue == null ? undefined : isMultipleCellValue ? 'manyMany' : 'manyOne';
    const lookupOptionsWithRelationship: ILookupOptionsDTO = {
      ...lookupOptions,
      ...(resolvedRelationship
        ? { relationship: resolvedRelationship }
        : fallbackRelationship
          ? { relationship: fallbackRelationship }
          : {}),
    };

    // Enrich lookupOptions with the parent link field's stable physical join metadata
    // (fkHostTableName / selfKeyName / foreignKeyName). Without these the client's fieldVoSchema
    // rejects the lookup. The lookup's own options (incl. its own filter) come first and are kept.
    const linkOptions = this.resolveLinkFieldOptions?.(lookupOptions.linkFieldId);
    const enrichedLookupOptions: ILookupOptionsDTO = linkOptions
      ? ({
          ...lookupOptionsWithRelationship,
          ...this.pickLinkJoinMetadata(linkOptions),
        } as ILookupOptionsDTO)
      : lookupOptionsWithRelationship;

    // For pending lookup fields (inner field not yet resolved), use singleLineText as default type
    if (field.isPending()) {
      return ok({
        ...baseDto,
        type: 'singleLineText' as const,
        isLookup: true,
        isConditionalLookup,
        lookupOptions: enrichedLookupOptions,
        isComputed: true,
        ...(isMultipleCellValue != null ? { isMultipleCellValue } : {}),
      });
    }

    // Resolve the document-root cellValueType (v1 format). The shape-refresh projection reads
    // this back; if it is absent the realtime op would publish a null cellValueType and corrupt
    // the field on the client until a full reload.
    const cellValueTypeResult = field.cellValueType();

    // Get the inner field's DTO representation
    return field
      .innerField()
      .andThen((inner) => inner.accept(this))
      .map((innerDto: ITableFieldPersistenceDTO) => {
        const unwrappedInner = unwrapConditionalLookupInner(innerDto);
        const mergedInnerOptions = mergeLookupInnerOptions({
          innerOptions: unwrappedInner.innerOptions,
          innerOptionsPatch: field.innerOptionsPatch(),
          innerType: unwrappedInner.innerType ?? innerDto.type,
          normalizeRegularLookupFormulaOptions: true,
        });
        const {
          innerType: _innerType,
          innerOptions: _innerOptions,
          ...innerShape
        } = innerDto as
          | (ITableFieldPersistenceDTO & {
              innerType?: ITableFieldPersistenceDTO['type'];
              innerOptions?: unknown;
            })
          | Record<string, unknown>;

        return {
          ...innerShape,
          ...baseDto,
          id: field.id().toString(),
          name: field.name().toString(),
          type: unwrappedInner.innerType ?? innerDto.type,
          isLookup: true,
          isConditionalLookup,
          lookupOptions: enrichedLookupOptions,
          isComputed: true,
          ...(mergedInnerOptions !== undefined ? { options: mergedInnerOptions } : {}),
          ...(isMultipleCellValue != null ? { isMultipleCellValue } : {}),
          ...(cellValueTypeResult.isOk()
            ? { cellValueType: cellValueTypeResult.value.toString() }
            : {}),
        } as ITableFieldPersistenceDTO;
      });
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
   *
   * NOTE: v1 compat classification flags (isLookup, isConditionalLookup) are NOT set here
   * because v2 core uses the field type for classification. These flags are derived at the
   * v1 adapter layer (normalizeFieldVo in FieldOpenApiV2Service) from the v2 field type.
   */
  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<ITableFieldPersistenceDTO, DomainError> {
    const baseDto = this.baseField(field);
    const options: IConditionalLookupOptionsDTO =
      field.conditionalLookupOptionsDto() as IConditionalLookupOptionsDTO;

    // Resolve isMultipleCellValue from the field's cell value multiplicity
    // (same pattern as ConditionalRollupField and FormulaField)
    const multiplicityResult = field.isMultipleCellValue();
    const isMultipleCellValue = multiplicityResult.isOk()
      ? multiplicityResult.value.toBoolean()
      : undefined;

    // For pending conditional lookup fields (inner field not yet resolved)
    if (field.isPending()) {
      return ok({
        ...baseDto,
        type: 'conditionalLookup' as const,
        options,
        isComputed: true,
        ...(isMultipleCellValue != null ? { isMultipleCellValue } : {}),
      });
    }

    // Get inner field info for value type resolution
    return field.innerField().andThen((inner) =>
      inner.accept(this).map((innerDto: ITableFieldPersistenceDTO) => {
        const unwrapped = unwrapConditionalLookupInner(innerDto);
        const innerValueType = inner.accept(new FieldValueTypeVisitor());
        const cellValueType = innerValueType.isOk()
          ? innerValueType.value.cellValueType.toString()
          : undefined;
        const mergedInnerOptions = mergeLookupInnerOptions({
          innerOptions: unwrapped.innerOptions,
          innerOptionsPatch: field.innerOptionsPatch(),
          innerType: unwrapped.innerType,
          normalizeRegularLookupFormulaOptions: false,
        });
        return {
          ...baseDto,
          type: 'conditionalLookup' as const,
          options,
          innerType: unwrapped.innerType,
          innerOptions: mergedInnerOptions,
          isComputed: true,
          ...(cellValueType != null ? { cellValueType } : {}),
          ...(isMultipleCellValue != null ? { isMultipleCellValue } : {}),
        };
      })
    );
  }
}

const mapFieldToDto = (
  field: Field,
  visitor: FieldToPersistenceVisitor
): Result<ITableFieldPersistenceDTO, DomainError> => field.accept(visitor);

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
      view.queryDefaults().map((queryDefaults) => {
        const metadataResult = view.auditMetadata();
        const versionResult = view.version();
        return {
          id: view.id().toString(),
          name: view.name().toString(),
          type,
          ...(versionResult.isOk() ? { version: versionResult.value.toNumber() } : {}),
          ...view.properties().toDto(),
          columnMeta: columnMeta.toDto(),
          query: queryDefaults.toDto(),
          ...(queryDefaults.sourceFilter() !== undefined
            ? { sourceFilter: queryDefaults.sourceFilter() }
            : {}),
          ...(view.options() !== undefined ? { options: view.options() } : {}),
          ...(view.order().isOk() ? { order: view.order()._unsafeUnwrap().toNumber() } : {}),
          ...(metadataResult.isOk() ? metadataResult.value.toDto() : {}),
        };
      })
    );
  }
}

export class DefaultTableMapper implements ITableMapper {
  toViewDTO(view: View): Result<ITableViewPersistenceDTO, DomainError> {
    return view.accept(new ViewToPersistenceVisitor());
  }

  toDTO(table: Table): Result<ITablePersistenceDTO, DomainError> {
    const relationshipByLinkFieldId = new Map<string, ILinkFieldOptionsDTO['relationship']>();
    const linkOptionsByLinkFieldId = new Map<string, ILinkFieldOptionsDTO>();
    for (const field of table.getFields()) {
      if (!(field instanceof LinkField)) {
        continue;
      }
      relationshipByLinkFieldId.set(field.id().toString(), field.relationship().toString());
      const linkOptionsResult = field.configDto();
      if (linkOptionsResult.isOk()) {
        linkOptionsByLinkFieldId.set(field.id().toString(), linkOptionsResult.value);
      }
    }

    const fieldVisitor = new FieldToPersistenceVisitor(
      (linkFieldId) => relationshipByLinkFieldId.get(linkFieldId),
      (linkFieldId) => linkOptionsByLinkFieldId.get(linkFieldId)
    );
    const dbTableName = table
      .dbTableName()
      .andThen((name) => name.value())
      .match(
        (value) => value,
        () => undefined
      );
    return sequenceResults(
      table.getFields().map((field) => mapFieldToDto(field, fieldVisitor))
    ).andThen((fields) =>
      sequenceResults(table.views().map((view) => this.toViewDTO(view))).map((views) => ({
        id: table.id().toString(),
        baseId: table.baseId().toString(),
        name: table.name().toString(),
        ...(table.description() !== undefined ? { description: table.description() } : {}),
        ...(table.icon() !== undefined ? { icon: table.icon() } : {}),
        ...(dbTableName ? { dbTableName } : {}),
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
    const propertiesResult = TableProperties.create({
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
    });

    const fieldsResult = sequenceResults(dto.fields.map((f) => this.mapFieldToDomain(f)));
    const viewsResult = sequenceResults(dto.views.map((v) => this.mapViewToDomain(v)));
    const dbTableNameResult = optional(dto.dbTableName, DbTableName.rehydrate);

    return idResult.andThen((id) =>
      baseIdResult.andThen((baseId) =>
        nameResult.andThen((name) =>
          primaryFieldIdResult.andThen((primaryFieldId) =>
            propertiesResult.andThen((properties) =>
              fieldsResult.andThen((fields) =>
                viewsResult.andThen((views) =>
                  dbTableNameResult.andThen((dbTableName) => {
                    const props: ITableBuildProps = {
                      id,
                      baseId,
                      name,
                      properties,
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
            ((innerFieldResult) => {
              const innerOptionsPatch = extractLookupDisplayOptionsPatch(dto.options);
              const lookupFieldResult = innerFieldResult.isOk()
                ? LookupField.create({
                    id,
                    name,
                    innerField: innerFieldResult.value,
                    lookupOptions,
                    isMultipleCellValue: dto.isMultipleCellValue,
                    innerOptionsPatch,
                  })
                : canDegradeBrokenLookupInner(dto.type)
                  ? LookupField.createPending({
                      id,
                      name,
                      lookupOptions,
                      isMultipleCellValue: dto.isMultipleCellValue,
                      innerOptionsPatch,
                    })
                  : err(innerFieldResult.error);

              return lookupFieldResult.andThen((field) =>
                this.applyDbFieldName(field, dto.dbFieldName)
                  .andThen((updated) => this.applyDbFieldType(updated, dbFieldType))
                  .andThen((updated) => this.applyHasError(updated, dto.hasError))
                  .map((updated) => updated as Field)
              );
            })(
              this.mapBaseFieldToDomain(
                dto.type === 'formula'
                  ? {
                      id: innerId.toString(),
                      name: dto.name,
                      type: 'formula' as const,
                      options: toRegularLookupFormulaOptions(
                        dto.options
                      ) as IFormulaFieldOptionsDTO,
                      ...(typeof dto.cellValueType === 'string'
                        ? { cellValueType: dto.cellValueType }
                        : {}),
                      ...(typeof dto.isMultipleCellValue === 'boolean'
                        ? { isMultipleCellValue: dto.isMultipleCellValue }
                        : {}),
                      ...(dto.meta != null ? { meta: dto.meta } : {}),
                    }
                  : dto.type === 'rollup'
                    ? {
                        ...dto,
                        isLookup: undefined,
                        lookupOptions: undefined,
                        id: innerId.toString(),
                        config: dto.config ?? lookupOptionsToRollupConfig(lookupOptionsRaw),
                      }
                    : {
                        ...dto,
                        isLookup: undefined,
                        lookupOptions: undefined,
                        id: innerId.toString(),
                      }
              )
            )
          )
        )
      )
    );
  }

  private mapConditionalLookupInnerField(
    dto: Extract<ITableFieldPersistenceDTO, { type: 'conditionalLookup' }>
  ): Result<Field | undefined, DomainError> {
    const unwrapped = unwrapConditionalLookupInner(dto);
    if (!unwrapped.innerType || unwrapped.innerType === 'conditionalLookup') {
      return ok(undefined);
    }

    return FieldId.generate()
      .andThen((innerId) =>
        this.mapBaseFieldToDomain({
          id: innerId.toString(),
          name: dto.name,
          type: unwrapped.innerType as ITableFieldPersistenceDTO['type'],
          options: unwrapped.innerOptions as never,
          ...(typeof dto.cellValueType === 'string' ? { cellValueType: dto.cellValueType } : {}),
          ...(typeof dto.isMultipleCellValue === 'boolean'
            ? { isMultipleCellValue: dto.isMultipleCellValue }
            : {}),
        } as ITableFieldPersistenceDTO)
      )
      .andThen((innerField) => {
        const valueTypeResult = innerField.accept(new FieldValueTypeVisitor());
        if (valueTypeResult.isErr()) {
          return ok(undefined);
        }
        return ok(innerField);
      })
      .orElse(() => ok(undefined));
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
              return optional(options.showAs, LongTextShowAs.create).andThen((showAs) =>
                optional(options.defaultValue, TextDefaultValue.create).andThen((defaultValue) =>
                  LongTextField.create({ id, name, showAs, defaultValue })
                )
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
                          (resultType) => {
                            const result = FormulaField.create({
                              id,
                              name,
                              expression,
                              timeZone,
                              formatting,
                              showAs,
                              meta,
                              ...(resultType ? { resultType } : {}),
                            });
                            // If creation fails due to incompatible formatting/showAs
                            // (e.g., NumberFormatting on a string-result formula after a
                            // dependency field type change), retry without them.
                            if (result.isErr() && (formatting || showAs)) {
                              return FormulaField.create({
                                id,
                                name,
                                expression,
                                timeZone,
                                meta,
                                ...(resultType ? { resultType } : {}),
                              });
                            }
                            return result;
                          }
                        )
                      )
                    )
                  )
                )
              );
            })
            .with({ type: 'rollup' }, (dto) => {
              const options = dto.options ?? ({} as { expression?: unknown });
              const configRaw = dto.config;
              if (!configRaw)
                return err(domainError.validation({ message: 'RollupField config is required' }));
              const parsedExpression = RollupExpression.create(options.expression);
              const expression = parsedExpression.isOk()
                ? parsedExpression.value
                : RollupExpression.default();
              const invalidExpression = parsedExpression.isErr();
              return RollupFieldConfig.create(configRaw).andThen((config) =>
                optional(options.timeZone, TimeZone.create).andThen((timeZone) =>
                  parseFormulaFormatting(options.formatting).andThen((formatting) =>
                    parseFormulaShowAs(options.showAs).andThen((showAs) =>
                      parseFormulaResultType(dto.cellValueType, dto.isMultipleCellValue).andThen(
                        (resultType) =>
                          (resultType
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
                          ).andThen((field) =>
                            this.applyHasError(field, invalidExpression ? true : dto.hasError)
                          )
                      )
                    )
                  )
                )
              );
            })
            .with({ type: 'singleSelect' }, (dto) => {
              const optionsDto = dto.options ?? { choices: [] };
              const choices = deduplicateSelectChoiceDtos(optionsDto.choices ?? []);
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
              const choices = deduplicateSelectChoiceDtos(optionsDto.choices ?? []);
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
                        optional(options.confirm, ButtonConfirm.create).andThen((confirm) =>
                          ButtonField.create({
                            id,
                            name,
                            label,
                            color,
                            maxCount,
                            resetCount,
                            workflow,
                            confirm,
                          })
                        )
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
                this.mapConditionalLookupInnerField(dto).andThen((innerField) => {
                  const unwrapped = unwrapConditionalLookupInner(dto);
                  const innerOptionsPatch = extractLookupDisplayOptionsPatch(
                    unwrapped.innerOptions
                  );
                  return innerField
                    ? ConditionalLookupField.create({
                        id,
                        name,
                        innerField,
                        conditionalLookupOptions,
                        isMultipleCellValue: dto.isMultipleCellValue,
                        innerOptionsPatch,
                      })
                    : ConditionalLookupField.createPending({
                        id,
                        name,
                        conditionalLookupOptions,
                        isMultipleCellValue: dto.isMultipleCellValue,
                        innerOptionsPatch,
                      });
                })
              );
            })
            .exhaustive();
        })
      )
      .andThen((field) => this.applyFieldValidation(field, dto.notNull, dto.unique))
      .andThen((field) => this.applyDescription(field, dto.description))
      .andThen((field) => this.applyAiConfig(field, dto.aiConfig))
      .andThen((field) => this.applyDbFieldName(field, dto.dbFieldName))
      .andThen((field) => this.applyDbFieldType(field, dto.dbFieldType))
      .andThen((field) => this.applyHasError(field, dto.hasError));
  }

  private applyDescription(
    field: Field,
    description: string | null | undefined
  ): Result<Field, DomainError> {
    if (description === undefined) return ok(field);
    return field.setDescription(description).map(() => field);
  }

  private applyAiConfig(
    field: Field,
    aiConfig: unknown | null | undefined
  ): Result<Field, DomainError> {
    if (aiConfig === undefined) return ok(field);
    return field.setAiConfig(aiConfig).map(() => field);
  }

  private mapViewToDomain(dto: ITableViewPersistenceDTO): Result<View, DomainError> {
    return ViewId.create(dto.id).andThen((id) =>
      ViewName.create(dto.name).andThen((name) => {
        return ViewProperties.rehydrate({
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.isLocked !== undefined ? { isLocked: dto.isLocked } : {}),
          ...(dto.enableShare !== undefined ? { enableShare: dto.enableShare } : {}),
          ...(dto.shareId !== undefined ? { shareId: dto.shareId } : {}),
          ...(dto.shareMeta !== undefined ? { shareMeta: dto.shareMeta } : {}),
        }).andThen((properties) => {
          const viewResult = createView({ type: dto.type, id, name, properties });

          return viewResult.andThen((view) =>
            ViewColumnMeta.rehydrate(dto.columnMeta).andThen((columnMeta) =>
              view
                .setColumnMeta(columnMeta)
                .andThen(() =>
                  ViewQueryDefaults.rehydrate(dto.query ?? {}, {
                    sourceFilter: dto.sourceFilter,
                  })
                )
                .andThen((queryDefaults) => view.setQueryDefaults(queryDefaults))
                .andThen(() => view.setOptions(dto.options))
                .andThen(() =>
                  dto.order === undefined
                    ? ok(undefined)
                    : ViewOrder.rehydrate(dto.order).andThen((order) => view.setOrder(order))
                )
                .andThen(() =>
                  dto.version === undefined
                    ? ok(undefined)
                    : ViewVersion.rehydrate(dto.version).andThen((version) =>
                        view.setVersion(version)
                      )
                )
                .andThen(() => {
                  if (dto.createdBy === undefined && dto.createdTime === undefined) {
                    return ok(undefined);
                  }
                  return ViewAuditMetadata.rehydrate({
                    createdBy: dto.createdBy,
                    createdTime: dto.createdTime,
                    ...(dto.lastModifiedBy !== undefined
                      ? { lastModifiedBy: dto.lastModifiedBy }
                      : {}),
                    ...(dto.lastModifiedTime !== undefined
                      ? { lastModifiedTime: dto.lastModifiedTime }
                      : {}),
                  }).andThen((metadata) => view.setAuditMetadata(metadata));
                })
                .map(() => view)
            )
          );
        });
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
    if (hasError == null) return ok(field);
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
