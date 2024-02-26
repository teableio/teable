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
    groupingFieldId: z.string().openapi({ description: 'The field id of the board group.' }),
  })
  .strict();

export class KanbanViewCore extends ViewCore {
  type!: ViewType.Kanban;

  options!: IKanbanViewOptions;

  columnMeta!: IKanbanColumnMeta;
}
