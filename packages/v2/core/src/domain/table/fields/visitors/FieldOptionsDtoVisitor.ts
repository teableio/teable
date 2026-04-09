import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

/**
 * Visitor that extracts the options DTO from a Field domain object.
 * Returns the plain options object that corresponds to the field's type-specific options.
 *
 * Used by event generation to capture old/new options during field type conversion,
 * ensuring realtime projections and action triggers include accurate option changes.
 */
export class FieldOptionsDtoVisitor implements IFieldVisitor<unknown> {
  visitSingleLineTextField(field: SingleLineTextField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {};
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();
    return ok(options);
  }

  visitLongTextField(field: LongTextField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {};
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();
    return ok(options);
  }

  visitNumberField(field: NumberField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {
      formatting: field.formatting().toDto(),
    };
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toNumber();
    return ok(options);
  }

  visitRatingField(field: RatingField): Result<unknown, DomainError> {
    return ok({
      icon: field.ratingIcon().toString(),
      color: field.ratingColor().toString(),
      max: field.ratingMax().toNumber(),
    });
  }

  visitFormulaField(field: FormulaField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    return ok(options);
  }

  visitRollupField(field: RollupField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    return ok(options);
  }

  visitSingleSelectField(field: SingleSelectField): Result<unknown, DomainError> {
    return this.visitSelectField(field);
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<unknown, DomainError> {
    return this.visitSelectField(field);
  }

  visitCheckboxField(field: CheckboxField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {};
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toBoolean();
    return ok(options);
  }

  visitAttachmentField(_field: AttachmentField): Result<unknown, DomainError> {
    return ok({});
  }

  visitDateField(field: DateField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {
      formatting: field.formatting().toDto(),
    };
    const defaultValue = field.defaultValue();
    if (defaultValue) options.defaultValue = defaultValue.toString();
    return ok(options);
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<unknown, DomainError> {
    return ok({
      expression: field.expression().toString(),
      formatting: field.formatting().toDto(),
    });
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<unknown, DomainError> {
    const trackedFieldIds = field.trackedFieldIds().map((id) => id.toString());
    const options: Record<string, unknown> = {
      expression: field.expression().toString(),
      formatting: field.formatting().toDto(),
    };
    if (trackedFieldIds.length > 0) options.trackedFieldIds = trackedFieldIds;
    return ok(options);
  }

  visitUserField(field: UserField): Result<unknown, DomainError> {
    const defaultValue = field.defaultValue();
    const options: Record<string, unknown> = {
      isMultiple: field.multiplicity().toBoolean(),
      shouldNotify: field.notification().toBoolean(),
    };
    if (defaultValue) options.defaultValue = defaultValue.toDto();
    return ok(options);
  }

  visitCreatedByField(_field: CreatedByField): Result<unknown, DomainError> {
    return ok({});
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<unknown, DomainError> {
    const trackedFieldIds = field.trackedFieldIds().map((id) => id.toString());
    const options: Record<string, unknown> = {};
    if (trackedFieldIds.length > 0) options.trackedFieldIds = trackedFieldIds;
    return ok(options);
  }

  visitAutoNumberField(field: AutoNumberField): Result<unknown, DomainError> {
    return ok({
      expression: field.expression().toString(),
    });
  }

  visitButtonField(field: ButtonField): Result<unknown, DomainError> {
    const maxCount = field.maxCount();
    const resetCount = field.resetCount();
    const workflow = field.workflow();
    const confirm = field.confirm();
    const options: Record<string, unknown> = {
      label: field.label().toString(),
      color: field.color().toString(),
    };
    if (maxCount) options.maxCount = maxCount.toNumber();
    if (resetCount) options.resetCount = resetCount.toBoolean();
    if (workflow) options.workflow = workflow.toDto();
    if (confirm) options.confirm = confirm.toDto();
    return ok(options);
  }

  visitLinkField(field: LinkField): Result<unknown, DomainError> {
    return field.configDto().map((config) => config);
  }

  visitLookupField(field: LookupField): Result<unknown, DomainError> {
    const innerResult = field.innerField();
    if (innerResult.isErr()) return ok({});
    return innerResult.value.accept(this);
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<unknown, DomainError> {
    const options: Record<string, unknown> = {
      expression: field.expression().toString(),
    };
    const timeZone = field.timeZone();
    if (timeZone) options.timeZone = timeZone.toString();
    const formatting = field.formatting();
    if (formatting) options.formatting = formatting.toDto();
    const showAs = field.showAs();
    if (showAs) options.showAs = showAs.toDto();
    return ok(options);
  }

  visitConditionalLookupField(field: ConditionalLookupField): Result<unknown, DomainError> {
    return ok(field.conditionalLookupOptionsDto());
  }

  private visitSelectField(
    field: SingleSelectField | MultipleSelectField
  ): Result<unknown, DomainError> {
    const defaultValue = field.defaultValue();
    const preventAutoNewOptions = field.preventAutoNewOptions().toBoolean();
    const options: Record<string, unknown> = {
      choices: field.selectOptions().map((option) => option.toDto()),
    };
    if (defaultValue) options.defaultValue = defaultValue.toDto();
    if (preventAutoNewOptions) options.preventAutoNewOptions = preventAutoNewOptions;
    return ok(options);
  }
}
