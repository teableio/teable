import z from 'zod';
import { Colors } from '../../field';
import type { ICalendarColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface ICalendarView extends IViewVo {
  type: ViewType.Calendar;
  options: ICalendarViewOptions;
}

export type ICalendarViewOptions = z.infer<typeof calendarViewOptionSchema>;

export enum ColorConfigType {
  Field = 'field',
  Custom = 'custom',
}

export const colorConfigSchema = z
  .object({
    type: z.nativeEnum(ColorConfigType),
    fieldId: z.string().optional().nullable().openapi({
      description: 'The color field id.',
    }),
    color: z.nativeEnum(Colors).optional().nullable().openapi({
      description: 'The color.',
    }),
  })
  .optional()
  .nullable();

export type IColorConfig = z.infer<typeof colorConfigSchema>;

export const calendarViewOptionSchema = z
  .object({
    startDateFieldId: z.string().optional().nullable().openapi({
      description: 'The start date field id.',
    }),
    endDateFieldId: z.string().optional().nullable().openapi({
      description: 'The end date field id.',
    }),
    titleFieldId: z.string().optional().nullable().openapi({
      description: 'The title field id.',
    }),
    colorConfig: colorConfigSchema,
  })
  .strict();

export class CalendarViewCore extends ViewCore {
  type!: ViewType.Calendar;

  options!: ICalendarViewOptions;

  columnMeta!: ICalendarColumnMeta;
}
