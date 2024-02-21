import z from 'zod';
import type { IKanbanColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IKanbanView extends IViewVo {
  type: ViewType.Kanban;
  options: KanbanViewOptions;
}

export class KanbanViewOptions {
  groupingFieldId!: string;
}

export const kanbanViewOptionSchema = z
  .object({
    groupingFieldId: z.string(),
  })
  .strict();

export class KanbanViewCore extends ViewCore {
  type!: ViewType.Kanban;

  options!: KanbanViewOptions;

  columnMeta!: IKanbanColumnMeta;
}
