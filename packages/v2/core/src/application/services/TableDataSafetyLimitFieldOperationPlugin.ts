import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IFieldUpdateInput } from '../../commands/UpdateFieldCommand';
import type { IDomainContext } from '../../domain/shared/DomainContext';
import type { DomainError } from '../../domain/shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  measureJsonBytes,
  resolveTableDataSafetyLimits,
  type ResolvedTableDataSafetyLimitConfig,
} from '../../domain/shared/TableDataSafetyLimits';
import type { Field } from '../../domain/table/fields/Field';
import type { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import type { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { getDomainContext } from '../../ports/ExecutionContext';
import {
  FieldOperationKind,
  type FieldOperationPluginContext,
  type IFieldOperationPlugin,
} from '../../ports/FieldOperationPlugin';
import {
  createDefaultTableDataSafetyLimitComposer,
  TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';

type PreparedTableDataSafetyFieldLimitState = {
  readonly domainContext: IDomainContext | undefined;
  readonly limits: ResolvedTableDataSafetyLimitConfig;
};

type SelectLikeField = SingleSelectField | MultipleSelectField;
type FormulaLikeField = Field & { expression(): { toString(): string } };

const fieldDescription = (field: Field): string | null => field.description();

const selectOptions = (field: SelectLikeField) =>
  field.selectOptions().map((option) => option.toDto());

const selectDefaultValues = (field: SelectLikeField): ReadonlyArray<string> => {
  const dto = field.defaultValue()?.toDto();
  if (dto == null) return [];
  return Array.isArray(dto) ? dto : [dto];
};

const isSelectField = (field: Field): field is SelectLikeField => {
  const type = field.type().toString();
  return type === 'singleSelect' || type === 'multipleSelect';
};

const isFormulaLikeField = (field: Field): field is FormulaLikeField => {
  const type = field.type().toString();
  return (
    (type === 'formula' || type === 'rollup' || type === 'conditionalRollup') &&
    'expression' in field &&
    typeof (field as { expression?: unknown }).expression === 'function'
  );
};

const formulaExpression = (field: FormulaLikeField): string => field.expression().toString();

const rawSelectOptionNames = (options: unknown): ReadonlyArray<string> => {
  if (Array.isArray(options)) {
    return options.map((value) => String(value));
  }

  if (!options || typeof options !== 'object') {
    return [];
  }

  const choices = (options as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    return choices.map((choice) =>
      choice && typeof choice === 'object' && 'name' in choice
        ? String((choice as { name?: unknown }).name ?? '')
        : ''
    );
  }

  return [];
};

const rawDefaultValueCount = (options: unknown): number => {
  if (!options || typeof options !== 'object' || !('defaultValue' in options)) {
    return 0;
  }
  const defaultValue = (options as { defaultValue?: unknown }).defaultValue;
  if (defaultValue == null) return 0;
  return Array.isArray(defaultValue) ? defaultValue.length : 1;
};

const mayContainSelectDefaultValues = (fieldUpdate: IFieldUpdateInput): boolean => {
  if (fieldUpdate.type === 'singleSelect' || fieldUpdate.type === 'multipleSelect') {
    return true;
  }
  const options = fieldUpdate.options;
  return Boolean(options && typeof options === 'object' && 'choices' in options);
};

const rawFormulaExpression = (fieldUpdate: IFieldUpdateInput): string | undefined => {
  const options = fieldUpdate.options;
  if (!options || typeof options !== 'object' || !('expression' in options)) {
    return undefined;
  }
  const expression = (options as { expression?: unknown }).expression;
  return typeof expression === 'string' ? expression : undefined;
};

const ensureDisplayText = (
  field: Field,
  domainContext: IDomainContext | undefined,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  const nameResult = ensureWithinTableDataSafetyLimit(
    'validation.limit.name_max_length',
    field.name().toString().length,
    limits.displayText.maxNameLength,
    {
      target: 'field.name',
      fieldId: field.id().toString(),
    }
  );
  if (nameResult.isErr()) return nameResult;

  const description = fieldDescription(field);
  if (description == null) return ok(undefined);
  return ensureWithinTableDataSafetyLimit(
    'validation.limit.description_max_length',
    description.length,
    limits.displayText.maxDescriptionLength,
    {
      target: 'field.description',
      fieldId: field.id().toString(),
    }
  );
};

const ensureSelectFieldLimits = (
  field: SelectLikeField,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  const options = selectOptions(field);
  const optionsBytesResult = ensureWithinTableDataSafetyLimit(
    'validation.limit.field_options_max_bytes',
    measureJsonBytes(options),
    limits.fieldOptions.maxBytes,
    {
      fieldId: field.id().toString(),
      fieldType: field.type().toString(),
    }
  );
  if (optionsBytesResult.isErr()) return optionsBytesResult;

  const choiceCountResult = ensureWithinTableDataSafetyLimit(
    'validation.limit.select_choices_max',
    options.length,
    limits.fieldOptions.maxSelectChoices,
    {
      fieldId: field.id().toString(),
      fieldType: field.type().toString(),
    }
  );
  if (choiceCountResult.isErr()) return choiceCountResult;

  for (const option of options) {
    const nameResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.select_choice_name_max_length',
      option.name.length,
      limits.fieldOptions.maxSelectChoiceNameLength,
      {
        fieldId: field.id().toString(),
        fieldType: field.type().toString(),
        choiceId: option.id,
      }
    );
    if (nameResult.isErr()) return nameResult;
  }

  return ensureWithinTableDataSafetyLimit(
    'validation.limit.select_default_values_max',
    selectDefaultValues(field).length,
    limits.fieldOptions.maxSelectDefaultValues,
    {
      fieldId: field.id().toString(),
      fieldType: field.type().toString(),
    }
  );
};

const ensureFormulaLength = (
  field: FormulaLikeField,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  return ensureWithinTableDataSafetyLimit(
    'validation.limit.formula_max_length',
    formulaExpression(field).length,
    limits.computed.maxFormulaLength,
    {
      fieldId: field.id().toString(),
      fieldType: field.type().toString(),
    }
  );
};

export const ensureTableDataSafetyFieldLimits = (
  field: Field,
  domainContext: IDomainContext | undefined,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  const displayResult = ensureDisplayText(field, domainContext, limits);
  if (displayResult.isErr()) return displayResult;
  if (isSelectField(field)) {
    const selectResult = ensureSelectFieldLimits(field, limits);
    if (selectResult.isErr()) return selectResult;
  }
  if (isFormulaLikeField(field)) {
    return ensureFormulaLength(field, limits);
  }
  return ok(undefined);
};

const ensureRawUpdateLimits = (
  fieldUpdate: IFieldUpdateInput,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  if (fieldUpdate.name != null) {
    const nameResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.name_max_length',
      fieldUpdate.name.length,
      limits.displayText.maxNameLength,
      { target: 'field.name' }
    );
    if (nameResult.isErr()) return nameResult;
  }
  if (fieldUpdate.description != null) {
    const descriptionResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.description_max_length',
      fieldUpdate.description.length,
      limits.displayText.maxDescriptionLength,
      { target: 'field.description' }
    );
    if (descriptionResult.isErr()) return descriptionResult;
  }
  if (fieldUpdate.options != null) {
    const optionsBytesResult = ensureWithinTableDataSafetyLimit(
      'validation.limit.field_options_max_bytes',
      measureJsonBytes(fieldUpdate.options),
      limits.fieldOptions.maxBytes,
      { target: 'field.options' }
    );
    if (optionsBytesResult.isErr()) return optionsBytesResult;

    for (const name of rawSelectOptionNames(fieldUpdate.options)) {
      const nameResult = ensureWithinTableDataSafetyLimit(
        'validation.limit.select_choice_name_max_length',
        name.length,
        limits.fieldOptions.maxSelectChoiceNameLength,
        { target: 'field.options.choices.name' }
      );
      if (nameResult.isErr()) return nameResult;
    }

    if (mayContainSelectDefaultValues(fieldUpdate)) {
      const defaultValuesResult = ensureWithinTableDataSafetyLimit(
        'validation.limit.select_default_values_max',
        rawDefaultValueCount(fieldUpdate.options),
        limits.fieldOptions.maxSelectDefaultValues,
        { target: 'field.options.defaultValue' }
      );
      if (defaultValuesResult.isErr()) return defaultValuesResult;
    }
  }

  const expression = rawFormulaExpression(fieldUpdate);
  if (expression != null) {
    return ensureWithinTableDataSafetyLimit(
      'validation.limit.formula_max_length',
      expression.length,
      limits.computed.maxFormulaLength,
      { target: 'field.options.expression' }
    );
  }

  return ok(undefined);
};

export class TableDataSafetyLimitFieldOperationPlugin
  implements IFieldOperationPlugin<PreparedTableDataSafetyFieldLimitState>
{
  readonly name = 'table-data-safety-field-limit';
  readonly enforce = 'post' as const;

  constructor(
    private readonly limitComposer: TableDataSafetyLimitComposer = createDefaultTableDataSafetyLimitComposer()
  ) {}

  supports(operation: FieldOperationKind): boolean {
    return (
      operation === FieldOperationKind.create ||
      operation === FieldOperationKind.update ||
      operation === FieldOperationKind.duplicate
    );
  }

  async prepare(
    context: FieldOperationPluginContext
  ): Promise<Result<PreparedTableDataSafetyFieldLimitState, DomainError>> {
    const configResult = await this.limitComposer.compose(context.executionContext);
    if (configResult.isErr()) return err(configResult.error);
    return ok({
      domainContext: getDomainContext(context.executionContext),
      limits: resolveTableDataSafetyLimits(configResult.value),
    });
  }

  guard(
    context: FieldOperationPluginContext,
    preparedState: PreparedTableDataSafetyFieldLimitState | undefined
  ): Result<void, DomainError> {
    if (context.kind !== FieldOperationKind.update) {
      return ok(undefined);
    }
    return ensureRawUpdateLimits(
      context.payload.fieldUpdate,
      preparedState?.limits ?? resolveTableDataSafetyLimits()
    );
  }

  beforePersist(
    context: FieldOperationPluginContext,
    preparedState: PreparedTableDataSafetyFieldLimitState | undefined
  ): Result<void, DomainError> {
    const limits = preparedState?.limits ?? resolveTableDataSafetyLimits();
    if (context.kind === FieldOperationKind.create && context.result?.createdField) {
      return ensureTableDataSafetyFieldLimits(
        context.result.createdField,
        preparedState?.domainContext,
        limits
      );
    }
    if (context.kind === FieldOperationKind.update && context.result?.updatedField) {
      return ensureTableDataSafetyFieldLimits(
        context.result.updatedField,
        preparedState?.domainContext,
        limits
      );
    }
    if (context.kind === FieldOperationKind.duplicate && context.result?.duplicatedField) {
      return ensureTableDataSafetyFieldLimits(
        context.result.duplicatedField,
        preparedState?.domainContext,
        limits
      );
    }
    return ok(undefined);
  }
}
