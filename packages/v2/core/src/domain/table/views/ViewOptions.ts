import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { fieldColorSchema } from '../fields/types/FieldColor';
import type { IViewTypeLiteral } from './ViewType';

const gridViewOptionsSchema = z
  .object({
    rowHeight: z.enum(['short', 'medium', 'tall', 'extraTall', 'autoFit']).optional(),
    fieldNameDisplayLines: z.number().min(1).max(3).optional(),
    frozenColumnCount: z.number().min(0).optional(),
    frozenFieldId: z.string().optional(),
  })
  .strict();

const cardViewOptionsSchema = z
  .object({
    coverFieldId: z.string().optional().nullable(),
    isCoverFit: z.boolean().optional(),
    isFieldNameHidden: z.boolean().optional(),
  })
  .strict();

const kanbanViewOptionsSchema = cardViewOptionsSchema
  .extend({
    stackFieldId: z.string().optional(),
    isEmptyStackHidden: z.boolean().optional(),
  })
  .strict();

const galleryViewOptionsSchema = cardViewOptionsSchema;

const calendarViewOptionsSchema = z
  .object({
    startDateFieldId: z.string().optional().nullable(),
    endDateFieldId: z.string().optional().nullable(),
    titleFieldId: z.string().optional().nullable(),
    colorConfig: z
      .object({
        type: z.enum(['field', 'custom']),
        fieldId: z.string().optional().nullable(),
        color: fieldColorSchema.optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .strict();

const formViewOptionsSchema = z
  .object({
    coverUrl: z.string().optional(),
    logoUrl: z.string().optional(),
    submitLabel: z.string().optional(),
  })
  .strict();

const pluginViewOptionsSchema = z
  .object({
    pluginId: z.string(),
    pluginInstallId: z.string(),
    pluginLogo: z.string(),
  })
  .strict();

const schemaByType = {
  grid: gridViewOptionsSchema,
  calendar: calendarViewOptionsSchema,
  kanban: kanbanViewOptionsSchema,
  form: formViewOptionsSchema,
  gallery: galleryViewOptionsSchema,
  plugin: pluginViewOptionsSchema,
} satisfies Record<IViewTypeLiteral, z.ZodType>;

export const validateViewCreateOptions = (
  type: IViewTypeLiteral,
  raw: unknown
): Result<unknown, DomainError> => {
  if (raw === undefined && type !== 'plugin') return ok(undefined);

  const parsed = schemaByType[type].safeParse(raw);
  if (!parsed.success) {
    return err(
      domainError.validation({
        message: `Invalid ${type} View options`,
        details: z.formatError(parsed.error as z.ZodError),
      })
    );
  }
  return ok(parsed.data);
};

const asOptionsRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const mergeAndValidateViewOptions = (
  type: IViewTypeLiteral,
  current: unknown,
  patch: unknown
): Result<unknown, DomainError> => {
  const parsed = schemaByType[type].safeParse(patch);
  if (!parsed.success) {
    return err(
      domainError.validation({
        code: 'view.options_invalid',
        message: `Invalid ${type} View options`,
        details: { issues: parsed.error.issues },
      })
    );
  }

  return ok({
    ...asOptionsRecord(current),
    ...asOptionsRecord(parsed.data),
  });
};
