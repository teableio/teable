import { strictUnionMember, z } from '../../zod';
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
import { longTextFieldOptionsSchema } from './derivate/long-text-option.schema';
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
  strictUnionMember(rollupFieldOptionsSchema),
  strictUnionMember(conditionalRollupFieldOptionsSchema),
  strictUnionMember(formulaFieldOptionsSchema),
  strictUnionMember(linkFieldOptionsSchema),
  strictUnionMember(dateFieldOptionsSchema),
  strictUnionMember(checkboxFieldOptionsSchema),
  strictUnionMember(attachmentFieldOptionsSchema),
  strictUnionMember(singlelineTextFieldOptionsSchema),
  strictUnionMember(longTextFieldOptionsSchema),
  strictUnionMember(ratingFieldOptionsSchema),
  strictUnionMember(userFieldOptionsSchema),
  strictUnionMember(createdByFieldOptionsSchema),
  strictUnionMember(lastModifiedByFieldOptionsSchema),
  strictUnionMember(buttonFieldOptionsSchema),
]);

// Common options schema for lookup fields
export const commonOptionsSchema = z.object({
  showAs: unionShowAsSchema.optional(),
  formatting: unionFormattingSchema.optional(),
});

// Union of all field options for VO (view object) - includes all options
export const unionFieldOptionsVoSchema = z.union([
  unionFieldOptions,
  strictUnionMember(conditionalRollupFieldOptionsSchema),
  strictUnionMember(linkFieldOptionsSchema),
  strictUnionMember(selectFieldOptionsSchema),
  strictUnionMember(numberFieldOptionsSchema),
  strictUnionMember(autoNumberFieldOptionsSchema),
  strictUnionMember(createdTimeFieldOptionsSchema),
  lastModifiedTimeFieldOptionsSchema,
]);

// Union of all field options for RO (request object) - includes read-only variants
export const unionFieldOptionsRoSchema = z.union([
  unionFieldOptions,
  strictUnionMember(conditionalRollupFieldOptionsSchema),
  strictUnionMember(linkFieldOptionsRoSchema),
  strictUnionMember(selectFieldOptionsRoSchema),
  strictUnionMember(numberFieldOptionsRoSchema),
  strictUnionMember(autoNumberFieldOptionsRoSchema),
  strictUnionMember(createdTimeFieldOptionsRoSchema),
  lastModifiedTimeFieldOptionsRoSchema,
  strictUnionMember(commonOptionsSchema),
]);

// Union field meta schema
export const unionFieldMetaVoSchema = z
  .union([formulaFieldMetaSchema, linkFieldMetaSchema])
  .optional();

// Type definitions
export type IFieldOptionsRo = z.infer<typeof unionFieldOptionsRoSchema>;
export type IFieldOptionsVo = z.infer<typeof unionFieldOptionsVoSchema>;
export type IFieldMetaVo = z.infer<typeof unionFieldMetaVoSchema>;
