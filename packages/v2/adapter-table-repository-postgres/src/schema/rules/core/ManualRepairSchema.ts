import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type {
  SchemaRuleI18nMessage,
  SchemaRuleManualRepairOption,
  SchemaRuleManualRepairSchema,
  SchemaRuleManualRepairSchemaProperty,
} from './ISchemaRule';

type ZodTypeAny = z.ZodTypeAny;
type ZodObjectShape = z.ZodRawShape;

type ManualRepairFormMeta = {
  title?: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
  submitLabel?: SchemaRuleI18nMessage;
};

type ManualRepairFieldMeta = {
  title?: SchemaRuleI18nMessage;
  description?: SchemaRuleI18nMessage;
  widget?: SchemaRuleManualRepairSchemaProperty['widget'];
  options?: Readonly<Record<string, SchemaRuleManualRepairOption>>;
};

const formMetaRegistry = new WeakMap<ZodTypeAny, ManualRepairFormMeta>();
const fieldMetaRegistry = new WeakMap<ZodTypeAny, ManualRepairFieldMeta>();

type UnwrappedSchema = {
  schema: ZodTypeAny;
  required: boolean;
  defaultValue?: string | boolean;
};

const unwrapSchema = (schema: ZodTypeAny): UnwrappedSchema => {
  let current = schema;
  let required = true;
  let defaultValue: string | boolean | undefined;

  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      required = false;
      current = current.unwrap();
      continue;
    }

    if (current instanceof z.ZodDefault) {
      const rawDefaultValue = current._def.defaultValue;
      const candidate = typeof rawDefaultValue === 'function' ? rawDefaultValue() : rawDefaultValue;
      if (typeof candidate === 'string' || typeof candidate === 'boolean') {
        defaultValue = candidate;
      }
      current = current._def.innerType;
      continue;
    }

    return {
      schema: current,
      required,
      defaultValue,
    };
  }
};

const serializeFieldSchema = (
  schema: ZodTypeAny,
  key: string
): Result<{ property: SchemaRuleManualRepairSchemaProperty; required: boolean }, Error> => {
  const { schema: unwrapped, required, defaultValue } = unwrapSchema(schema);
  const meta = fieldMetaRegistry.get(unwrapped) ?? fieldMetaRegistry.get(schema);

  if (unwrapped instanceof z.ZodEnum) {
    return ok({
      required,
      property: {
        type: 'string',
        widget: meta?.widget ?? 'select',
        title: meta?.title,
        description: meta?.description,
        options: unwrapped.options.map(
          (value: string): SchemaRuleManualRepairOption =>
            meta?.options?.[value] ?? {
              value,
              label: { fallback: value },
            }
        ),
        defaultValue,
      },
    });
  }

  if (unwrapped instanceof z.ZodBoolean) {
    return ok({
      required,
      property: {
        type: 'boolean',
        widget: meta?.widget ?? 'checkbox',
        title: meta?.title,
        description: meta?.description,
        defaultValue,
      },
    });
  }

  if (unwrapped instanceof z.ZodString) {
    return ok({
      required,
      property: {
        type: 'string',
        widget: meta?.widget ?? 'text',
        title: meta?.title,
        description: meta?.description,
        defaultValue,
      },
    });
  }

  return err(
    new Error(`Unsupported manual repair schema property "${key}" (${unwrapped._def.typeName})`)
  );
};

export const withManualRepairFormMeta = <T extends z.AnyZodObject>(
  schema: T,
  meta: ManualRepairFormMeta
): T => {
  formMetaRegistry.set(schema, meta);
  return schema;
};

export const withManualRepairFieldMeta = <T extends ZodTypeAny>(
  schema: T,
  meta: ManualRepairFieldMeta
): T => {
  fieldMetaRegistry.set(schema, meta);
  return schema;
};

export const serializeManualRepairSchema = (
  schema: z.AnyZodObject
): Result<SchemaRuleManualRepairSchema, Error> => {
  const shape: ZodObjectShape = schema.shape;
  const formMeta = formMetaRegistry.get(schema);
  const properties: Record<string, SchemaRuleManualRepairSchemaProperty> = {};
  const required: string[] = [];

  for (const [key, propertySchema] of Object.entries(shape)) {
    const propertyResult = serializeFieldSchema(propertySchema, key);
    if (propertyResult.isErr()) {
      return err(propertyResult.error);
    }

    const { property, required: isRequired } = propertyResult.value;
    properties[key] = property;

    if (isRequired) {
      required.push(key);
    }
  }

  return ok({
    type: 'object',
    title: formMeta?.title,
    description: formMeta?.description,
    submitLabel: formMeta?.submitLabel,
    required: required.length ? required : undefined,
    properties,
  });
};
