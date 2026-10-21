import { z } from 'zod';

/**
 * Per-field-type aiConfig schemas, mirroring v1's
 * `packages/core/src/models/field/ai-config` (T6520 parity): each field type
 * accepts only its own AI action types, and field types without an entry do
 * not accept an aiConfig at all.
 */

const commonAiConfigSchema = z.object({
  modelKey: z.string(),
  isAutoFill: z.boolean().nullable().optional(),
  attachPrompt: z.string().optional(),
});

const sourceFieldIdSchema = z.string().startsWith('fld');

export const textFieldAiConfigSchema = z.discriminatedUnion('type', [
  commonAiConfigSchema.extend({
    type: z.literal('extraction'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('summary'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('translation'),
    sourceFieldId: sourceFieldIdSchema,
    targetLanguage: z.string(),
  }),
  commonAiConfigSchema.extend({
    type: z.literal('improvement'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('customization'),
    prompt: z.string(),
  }),
]);

export const singleSelectFieldAiConfigSchema = z.discriminatedUnion('type', [
  commonAiConfigSchema.extend({
    type: z.literal('classification'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('customization'),
    prompt: z.string(),
    onlyAllowConfiguredOptions: z.boolean().optional(),
  }),
]);

export const multipleSelectFieldAiConfigSchema = z.discriminatedUnion('type', [
  commonAiConfigSchema.extend({
    type: z.literal('tag'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('customization'),
    prompt: z.string(),
    onlyAllowConfiguredOptions: z.boolean().optional(),
  }),
]);

const attachmentAiConfigBaseSchema = commonAiConfigSchema.extend({
  n: z.number().min(1).max(10).optional(),
  size: z
    .string()
    .regex(/^\d+x\d+$/, { message: 'Size must be in "widthxheight" format, e.g., "1024x1024"' })
    .optional(),
  quality: z.enum(['low', 'medium', 'high']).optional(),
  aspectRatio: z
    .string()
    .regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/, {
      message: 'Aspect ratio must be in "width:height" format, e.g., "16:9"',
    })
    .optional(),
  resolution: z.enum(['1K', '2K', '4K']).optional(),
});

export const attachmentFieldAiConfigSchema = z.discriminatedUnion('type', [
  attachmentAiConfigBaseSchema.extend({
    type: z.literal('imageGeneration'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  attachmentAiConfigBaseSchema.extend({
    type: z.literal('imageCustomization'),
    prompt: z.string(),
  }),
]);

export const ratingFieldAiConfigSchema = z.discriminatedUnion('type', [
  commonAiConfigSchema.extend({
    type: z.literal('rating'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('customization'),
    prompt: z.string(),
  }),
]);

export const dateFieldAiConfigSchema = z.discriminatedUnion('type', [
  commonAiConfigSchema.extend({
    type: z.literal('extraction'),
    sourceFieldId: sourceFieldIdSchema,
  }),
  commonAiConfigSchema.extend({
    type: z.literal('customization'),
    prompt: z.string(),
  }),
]);

/**
 * Returns the aiConfig schema for a field type, or undefined when the field
 * type does not support an aiConfig.
 */
export const getFieldAiConfigSchema = (fieldType: string): z.ZodType | undefined => {
  switch (fieldType) {
    case 'singleLineText':
    case 'longText':
      return textFieldAiConfigSchema;
    case 'singleSelect':
      return singleSelectFieldAiConfigSchema;
    case 'multipleSelect':
      return multipleSelectFieldAiConfigSchema;
    case 'attachment':
      return attachmentFieldAiConfigSchema;
    case 'rating':
    case 'number':
      return ratingFieldAiConfigSchema;
    case 'date':
      return dateFieldAiConfigSchema;
    default:
      return undefined;
  }
};

export type IFieldAiConfigValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly message: string };

/**
 * Validates an aiConfig value against the field type it is attached to.
 * `null`/`undefined` always validate (absent or explicitly cleared config).
 */
export const validateFieldAiConfig = (
  fieldType: string,
  aiConfig: unknown
): IFieldAiConfigValidationResult => {
  if (aiConfig === undefined || aiConfig === null) {
    return { valid: true };
  }

  const schema = getFieldAiConfigSchema(fieldType);
  if (!schema) {
    return {
      valid: false,
      message: `Field type ${fieldType} does not support aiConfig`,
    };
  }

  const parsed = schema.safeParse(aiConfig);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) =>
        issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
      )
      .join('; ');
    return {
      valid: false,
      message: `Invalid aiConfig for field type ${fieldType}: ${details}`,
    };
  }

  return { valid: true };
};
