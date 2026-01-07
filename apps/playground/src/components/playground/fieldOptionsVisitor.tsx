import type { ReactNode } from 'react';
import {
  ok,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type Field,
  type IFieldVisitor,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LookupField,
  type LongTextField,
  type MultipleSelectField,
  type NumberField,
  type NumberFormatting,
  type NumberShowAs,
  type FormulaField,
  type RatingField,
  type RollupField,
  type Result,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
} from '@teable/v2-core';

const emptyNode = <span className="text-xs text-muted-foreground">-</span>;

const formatTokens = (tokens: string[]): ReactNode => {
  if (tokens.length === 0) return emptyNode;
  return (
    <span className="flex flex-wrap gap-1 text-xs text-muted-foreground">
      {tokens.map((token, index) => (
        <span key={`${token}-${index}`} className="rounded border border-border/60 px-1.5 py-0.5">
          {token}
        </span>
      ))}
    </span>
  );
};

const tokenValue = (value: string | number | boolean): string => {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
};

const pushToken = (tokens: string[], label: string, value: string | number | boolean) => {
  tokens.push(`${label}:${tokenValue(value)}`);
};

const pushValidationTokens = (tokens: string[], field: Field) => {
  if (field.notNull().toBoolean()) pushToken(tokens, 'notNull', true);
  if (field.unique().toBoolean()) pushToken(tokens, 'unique', true);
};

const formatFieldTokens = (field: Field, tokens: string[]): ReactNode => {
  pushValidationTokens(tokens, field);
  return formatTokens(tokens);
};

const formatNumberFormattingTokens = (formatting: NumberFormatting): string[] => {
  const tokens: string[] = [];
  pushToken(tokens, 'format', formatting.type());
  pushToken(tokens, 'precision', formatting.precision().toNumber());
  const symbol = formatting.symbol();
  if (symbol) pushToken(tokens, 'symbol', symbol);
  return tokens;
};

const formatNumberShowAsTokens = (showAs: NumberShowAs): string[] => {
  const tokens: string[] = [];
  const dto = showAs.toDto();
  pushToken(tokens, 'showAs', dto.type);
  pushToken(tokens, 'color', dto.color);
  if ('maxValue' in dto) {
    pushToken(tokens, 'max', dto.maxValue);
    pushToken(tokens, 'value', dto.showValue);
  }
  return tokens;
};

const formatDefaultValue = (value: string | string[]): string =>
  Array.isArray(value) ? value.join(', ') : value;

export class FieldOptionsVisitor implements IFieldVisitor<ReactNode> {
  visitSingleLineTextField(field: SingleLineTextField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const showAs = field.showAs();
    if (showAs) pushToken(tokens, 'showAs', showAs.type());
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toString());
    return ok(formatFieldTokens(field, tokens));
  }

  visitLongTextField(field: LongTextField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toString());
    return ok(formatFieldTokens(field, tokens));
  }

  visitNumberField(field: NumberField): Result<ReactNode, string> {
    const tokens = [...formatNumberFormattingTokens(field.formatting())];
    const showAs = field.showAs();
    if (showAs) {
      tokens.push(...formatNumberShowAsTokens(showAs));
    }
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toNumber());
    return ok(formatFieldTokens(field, tokens));
  }

  visitRatingField(field: RatingField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'max', field.ratingMax().toNumber());
    pushToken(tokens, 'icon', field.ratingIcon().toString());
    pushToken(tokens, 'color', field.ratingColor().toString());
    return ok(formatFieldTokens(field, tokens));
  }

  visitFormulaField(field: FormulaField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'expr', field.expression().toString());
    const timeZone = field.timeZone();
    if (timeZone) pushToken(tokens, 'tz', timeZone.toString());
    const formatting = field.formatting();
    if (formatting) {
      const dto = formatting.toDto();
      if ('precision' in dto) {
        tokens.push(...formatNumberFormattingTokens(formatting as NumberFormatting));
      } else {
        pushToken(tokens, 'date', dto.date);
        pushToken(tokens, 'time', dto.time);
        pushToken(tokens, 'tz', dto.timeZone);
      }
    }
    const showAs = field.showAs();
    if (showAs) {
      const dto = showAs.toDto();
      if ('color' in dto) {
        tokens.push(...formatNumberShowAsTokens(showAs as NumberShowAs));
      } else {
        pushToken(tokens, 'showAs', dto.type);
      }
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitRollupField(field: RollupField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'expr', field.expression().toString());
    pushToken(tokens, 'link', field.linkFieldId().toString());
    pushToken(tokens, 'foreign', field.foreignTableId().toString());
    pushToken(tokens, 'lookup', field.lookupFieldId().toString());
    return ok(formatFieldTokens(field, tokens));
  }

  visitSingleSelectField(field: SingleSelectField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'choices', field.selectOptions().length);
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', formatDefaultValue(defaultValue.toDto()));
    if (field.preventAutoNewOptions().toBoolean()) pushToken(tokens, 'autoNew', 'off');
    return ok(formatFieldTokens(field, tokens));
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'choices', field.selectOptions().length);
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', formatDefaultValue(defaultValue.toDto()));
    if (field.preventAutoNewOptions().toBoolean()) pushToken(tokens, 'autoNew', 'off');
    return ok(formatFieldTokens(field, tokens));
  }

  visitCheckboxField(field: CheckboxField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const defaultValue = field.defaultValue();
    if (!defaultValue) {
      pushToken(tokens, 'default', 'unchecked');
    } else {
      pushToken(tokens, 'default', defaultValue.toBoolean() ? 'checked' : 'unchecked');
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitAttachmentField(field: AttachmentField): Result<ReactNode, string> {
    return ok(formatFieldTokens(field, []));
  }

  visitDateField(field: DateField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const formatting = field.formatting();
    pushToken(tokens, 'date', formatting.date());
    pushToken(tokens, 'time', formatting.time());
    pushToken(tokens, 'tz', formatting.timeZone().toString());
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toString());
    return ok(formatFieldTokens(field, tokens));
  }

  visitCreatedTimeField(field: CreatedTimeField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const formatting = field.formatting();
    pushToken(tokens, 'date', formatting.date());
    pushToken(tokens, 'time', formatting.time());
    pushToken(tokens, 'tz', formatting.timeZone().toString());
    pushToken(tokens, 'expr', field.expression().toString());
    return ok(formatFieldTokens(field, tokens));
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const formatting = field.formatting();
    pushToken(tokens, 'date', formatting.date());
    pushToken(tokens, 'time', formatting.time());
    pushToken(tokens, 'tz', formatting.timeZone().toString());
    pushToken(tokens, 'expr', field.expression().toString());
    const trackedFieldIds = field.trackedFieldIds();
    if (trackedFieldIds.length > 0) {
      pushToken(tokens, 'tracked', trackedFieldIds.length);
    } else {
      pushToken(tokens, 'tracked', 'all');
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitUserField(field: UserField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'mode', field.multiplicity().toBoolean() ? 'multiple' : 'single');
    pushToken(tokens, 'notify', field.notification().toBoolean());
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', formatDefaultValue(defaultValue.toDto()));
    return ok(formatFieldTokens(field, tokens));
  }

  visitCreatedByField(field: CreatedByField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'system', 'created');
    return ok(formatFieldTokens(field, tokens));
  }

  visitLastModifiedByField(field: LastModifiedByField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'system', 'modified');
    const trackedFieldIds = field.trackedFieldIds();
    if (trackedFieldIds.length > 0) {
      pushToken(tokens, 'tracked', trackedFieldIds.length);
    } else {
      pushToken(tokens, 'tracked', 'all');
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitAutoNumberField(field: AutoNumberField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'system', 'auto');
    return ok(formatFieldTokens(field, tokens));
  }

  visitButtonField(field: ButtonField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'label', field.label().toString());
    pushToken(tokens, 'color', field.color().toString());
    const maxCount = field.maxCount();
    if (maxCount) pushToken(tokens, 'max', maxCount.toNumber());
    const resetCount = field.resetCount();
    if (resetCount) pushToken(tokens, 'reset', resetCount.toBoolean());
    const workflow = field.workflow();
    if (workflow) {
      const workflowDto = workflow.toDto();
      const workflowLabel = workflowDto.name ?? workflowDto.id ?? 'workflow';
      pushToken(tokens, 'workflow', workflowLabel);
      if (workflowDto.isActive === false) pushToken(tokens, 'active', 'off');
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitLinkField(field: LinkField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'rel', field.relationship().toString());
    pushToken(tokens, 'foreign', field.foreignTableId().toString());
    pushToken(tokens, 'lookup', field.lookupFieldId().toString());
    if (field.isOneWay()) pushToken(tokens, 'oneWay', 'on');
    return ok(formatFieldTokens(field, tokens));
  }

  visitLookupField(field: LookupField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'link', field.linkFieldId().toString());
    pushToken(tokens, 'foreign', field.foreignTableId().toString());
    pushToken(tokens, 'lookup', field.lookupFieldId().toString());
    const innerTypeResult = field.innerFieldType();
    if (innerTypeResult.isOk()) {
      pushToken(tokens, 'inner', innerTypeResult.value.toString());
    } else {
      pushToken(tokens, 'inner', 'pending');
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitConditionalRollupField(field: ConditionalRollupField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'expr', field.expression().toString());
    pushToken(tokens, 'foreign', field.foreignTableId().toString());
    pushToken(tokens, 'lookup', field.lookupFieldId().toString());
    const condition = field.config().condition();
    if (condition.hasFilter()) {
      pushToken(tokens, 'filtered', 'yes');
    }
    if (condition.hasSort()) {
      pushToken(tokens, 'sorted', 'yes');
    }
    if (condition.hasLimit()) {
      pushToken(tokens, 'limit', condition.limit() ?? 0);
    }
    return ok(formatFieldTokens(field, tokens));
  }

  visitConditionalLookupField(field: ConditionalLookupField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'foreign', field.foreignTableId().toString());
    pushToken(tokens, 'lookup', field.lookupFieldId().toString());
    const innerTypeResult = field.innerFieldType();
    if (innerTypeResult.isOk()) {
      pushToken(tokens, 'inner', innerTypeResult.value.toString());
    } else {
      pushToken(tokens, 'inner', 'pending');
    }
    const condition = field.conditionalLookupOptions().condition();
    if (condition.hasFilter()) {
      pushToken(tokens, 'filtered', 'yes');
    }
    if (condition.hasSort()) {
      pushToken(tokens, 'sorted', 'yes');
    }
    if (condition.hasLimit()) {
      pushToken(tokens, 'limit', condition.limit() ?? 0);
    }
    return ok(formatFieldTokens(field, tokens));
  }
}

export const renderFieldOptions = (field: Field): ReactNode => {
  const result = field.accept(new FieldOptionsVisitor());
  if (result.isErr()) {
    return <span className="text-xs text-destructive">{result.error}</span>;
  }
  return result.value;
};
