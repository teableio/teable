import z from 'zod';
import type { IFormColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IFormView extends IViewVo {
  type: ViewType.Form;
  options: IFormViewOptions;
}

export type IFormViewOptions = z.infer<typeof formViewOptionSchema>;

export const formViewOptionSchema = z
  .object({
    coverUrl: z.string().optional().openapi({ description: 'The cover url of the form' }),
    logoUrl: z.string().optional().openapi({ description: 'The logo url of the form' }),
    submitLabel: z
      .string()
      .optional()
      .openapi({ description: 'The submit button text of the form' }),
  })
  .strict();

export class FormViewCore extends ViewCore {
  type!: ViewType.Form;

  options!: IFormViewOptions;

  columnMeta!: IFormColumnMeta;
}
