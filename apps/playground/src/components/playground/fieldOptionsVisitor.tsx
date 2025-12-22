import type { ReactNode } from 'react';
import {
  ok,
  type AttachmentField,
  type ButtonField,
  type CheckboxField,
  type DateField,
  type Field,
  type IFieldVisitor,
  type LongTextField,
  type MultipleSelectField,
  type NumberField,
  type NumberFormatting,
  type NumberShowAs,
  type RatingField,
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
    return ok(formatTokens(tokens));
  }

  visitLongTextField(field: LongTextField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toString());
    return ok(formatTokens(tokens));
  }

  visitNumberField(field: NumberField): Result<ReactNode, string> {
    const tokens = [...formatNumberFormattingTokens(field.formatting())];
    const showAs = field.showAs();
    if (showAs) {
      tokens.push(...formatNumberShowAsTokens(showAs));
    }
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toNumber());
    return ok(formatTokens(tokens));
  }

  visitRatingField(field: RatingField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'max', field.ratingMax().toNumber());
    pushToken(tokens, 'icon', field.ratingIcon().toString());
    pushToken(tokens, 'color', field.ratingColor().toString());
    return ok(formatTokens(tokens));
  }

  visitSingleSelectField(field: SingleSelectField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'choices', field.selectOptions().length);
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', formatDefaultValue(defaultValue.toDto()));
    if (field.preventAutoNewOptions().toBoolean()) pushToken(tokens, 'autoNew', 'off');
    return ok(formatTokens(tokens));
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'choices', field.selectOptions().length);
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', formatDefaultValue(defaultValue.toDto()));
    if (field.preventAutoNewOptions().toBoolean()) pushToken(tokens, 'autoNew', 'off');
    return ok(formatTokens(tokens));
  }

  visitCheckboxField(field: CheckboxField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const defaultValue = field.defaultValue();
    if (!defaultValue) {
      pushToken(tokens, 'default', 'unchecked');
    } else {
      pushToken(tokens, 'default', defaultValue.toBoolean() ? 'checked' : 'unchecked');
    }
    return ok(formatTokens(tokens));
  }

  visitAttachmentField(_field: AttachmentField): Result<ReactNode, string> {
    return ok(formatTokens([]));
  }

  visitDateField(field: DateField): Result<ReactNode, string> {
    const tokens: string[] = [];
    const formatting = field.formatting();
    pushToken(tokens, 'date', formatting.date());
    pushToken(tokens, 'time', formatting.time());
    pushToken(tokens, 'tz', formatting.timeZone().toString());
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', defaultValue.toString());
    return ok(formatTokens(tokens));
  }

  visitUserField(field: UserField): Result<ReactNode, string> {
    const tokens: string[] = [];
    pushToken(tokens, 'mode', field.multiplicity().toBoolean() ? 'multiple' : 'single');
    pushToken(tokens, 'notify', field.notification().toBoolean());
    const defaultValue = field.defaultValue();
    if (defaultValue) pushToken(tokens, 'default', formatDefaultValue(defaultValue.toDto()));
    return ok(formatTokens(tokens));
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
    return ok(formatTokens(tokens));
  }
}

export const renderFieldOptions = (field: Field): ReactNode => {
  const result = field.accept(new FieldOptionsVisitor());
  if (result.isErr()) {
    return <span className="text-xs text-destructive">{result.error}</span>;
  }
  return result.value;
};
