import { z } from '../../zod';
import {
  selectFieldOptionsRoSchema,
  selectFieldOptionsSchema,
} from './derivate/abstract/select-option.schema';
import { attachmentFieldOptionsSchema } from './derivate/attachment-option.schema';
import {
  autoNumberFieldOptionsRoSchema,
  autoNumberFieldOptionsSchema,
} from './derivate/auto-number-option.schema';
import { buttonFieldOptionsSchema } from './derivate/button-option.schema';
import { checkboxFieldOptionsSchema } from './derivate/checkbox-option.schema';
import { conditionalRollupFieldOptionsSchema } from './derivate/conditional-rollup-option.schema';
import { createdByFieldOptionsSchema } from './derivate/created-by-option.schema';
import {
  createdTimeFieldOptionsRoSchema,
  createdTimeFieldOptionsSchema,
} from './derivate/created-time-option.schema';
import { dateFieldOptionsSchema } from './derivate/date-option.schema';
import {
  formulaFieldMetaSchema,
  formulaFieldOptionsSchema,
} from './derivate/formula-option.schema';
import { lastModifiedByFieldOptionsSchema } from './derivate/last-modified-by-option.schema';
import {
  lastModifiedTimeFieldOptionsRoSchema,
  lastModifiedTimeFieldOptionsSchema,
} from './derivate/last-modified-time-option.schema';
import {
  linkFieldOptionsRoSchema,
  linkFieldOptionsSchema,
  linkFieldMetaSchema,
} from './derivate/link-option.schema';
import {
  numberFieldOptionsRoSchema,
  numberFieldOptionsSchema,
} from './derivate/number-option.schema';
import { ratingFieldOptionsSchema } from './derivate/rating-option.schema';
import { rollupFieldOptionsSchema } from './derivate/rollup-option.schema';
import { singlelineTextFieldOptionsSchema } from './derivate/single-line-text-option.schema';
import { userFieldOptionsSchema } from './derivate/user-option.schema';
import { unionFormattingSchema } from './formatting';
import { unionShowAsSchema } from './show-as';

// Union of all field options that don't have read-only variants
export const unionFieldOptions = z.union([
  rollupFieldOptionsSchema.strict(),
  conditionalRollupFieldOptionsSchema.strict(),
  formulaFieldOptionsSchema.strict(),
  linkFieldOptionsSchema.strict(),
  dateFieldOptionsSchema.strict(),
  checkboxFieldOptionsSchema.strict(),
  attachmentFieldOptionsSchema.strict(),
  singlelineTextFieldOptionsSchema.strict(),
  ratingFieldOptionsSchema.strict(),
  userFieldOptionsSchema.strict(),
  createdByFieldOptionsSchema.strict(),
  lastModifiedByFieldOptionsSchema.strict(),
  buttonFieldOptionsSchema.strict(),
]);

// Common options schema for lookup fields
export const commonOptionsSchema = z.object({
  showAs: unionShowAsSchema.optional(),
  formatting: unionFormattingSchema.optional(),
});

// Union of all field options for VO (view object) - includes all options
export const unionFieldOptionsVoSchema = z.union([
  unionFieldOptions,
  conditionalRollupFieldOptionsSchema.strict(),
  linkFieldOptionsSchema.strict(),
  selectFieldOptionsSchema.strict(),
  numberFieldOptionsSchema.strict(),
  autoNumberFieldOptionsSchema.strict(),
  createdTimeFieldOptionsSchema.strict(),
  lastModifiedTimeFieldOptionsSchema.strict(),
]);

// Union of all field options for RO (request object) - includes read-only variants
export const unionFieldOptionsRoSchema = z.union([
  unionFieldOptions,
  conditionalRollupFieldOptionsSchema.strict(),
  linkFieldOptionsRoSchema.strict(),
  selectFieldOptionsRoSchema.strict(),
  numberFieldOptionsRoSchema.strict(),
  autoNumberFieldOptionsRoSchema.strict(),
  createdTimeFieldOptionsRoSchema.strict(),
  lastModifiedTimeFieldOptionsRoSchema.strict(),
  commonOptionsSchema.strict(),
]);

// Union field meta schema
export const unionFieldMetaVoSchema = z
  .union([formulaFieldMetaSchema, linkFieldMetaSchema])
  .optional();

// Type definitions
export type IFieldOptionsRo = z.infer<typeof unionFieldOptionsRoSchema>;
export type IFieldOptionsVo = z.infer<typeof unionFieldOptionsVoSchema>;
export type IFieldMetaVo = z.infer<typeof unionFieldMetaVoSchema>;
