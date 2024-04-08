import z from 'zod';
import type { IKanbanColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IKanbanView extends IViewVo {
  type: ViewType.Kanban;
  options: IKanbanViewOptions;
}

export type IKanbanViewOptions = z.infer<typeof kanbanViewOptionSchema>;

export const kanbanViewOptionSchema = z
  .object({
    stackFieldId: z
      .string()
      .optional()
      .openapi({ description: 'The field id of the Kanban stack.' }),
    coverFieldId: z.string().optional().nullable().openapi({
      description:
        'The cover field id is a designated attachment field id, the contents of which appear at the top of each Kanban card.',
    }),
    isCoverFit: z.boolean().optional().openapi({
      description: 'If true, cover images are resized to fit Kanban cards.',
    }),
    isFieldNameHidden: z.boolean().optional().openapi({
      description: 'If true, hides field name in the Kanban cards.',
    }),
    isEmptyStackHidden: z.boolean().optional().openapi({
      description: 'If true, hides empty stacks in the Kanban.',
    }),
  })
  .strict();

export class KanbanViewCore extends ViewCore {
  type!: ViewType.Kanban;

  options!: IKanbanViewOptions;

  columnMeta!: IKanbanColumnMeta;
}
