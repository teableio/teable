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
      // Zod 4 types unwrap() with the core schema type; the runtime value is
      // always a classic schema instance.
      current = current.unwrap() as ZodTypeAny;
      continue;
    }

    if (current instanceof z.ZodDefault) {
      // Zod 4 exposes the resolved default through `def.defaultValue`; the
      // getter already invokes function-valued defaults.
      const candidate: unknown = current.def.defaultValue;
      if (typeof candidate === 'string' || typeof candidate === 'boolean') {
        defaultValue = candidate;
      }
      current = current.def.innerType as ZodTypeAny;
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
        options: unwrapped.options.map((value): SchemaRuleManualRepairOption => {
          // Zod 4 types enum options as `string | number`; manual repair
          // enums are always string-valued.
          const optionValue = String(value);
          return (
            meta?.options?.[optionValue] ?? {
              value: optionValue,
              label: { fallback: optionValue },
            }
          );
        }),
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

  return err(new Error(`Unsupported manual repair schema property "${key}" (${unwrapped.type})`));
};

export const withManualRepairFormMeta = <T extends z.ZodObject>(
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
  schema: z.ZodObject
): Result<SchemaRuleManualRepairSchema, Error> => {
  const shape = schema.shape;
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
