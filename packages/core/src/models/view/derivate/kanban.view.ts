import type { IKanbanColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';
import type { IKanbanViewOptions } from './kanban-view-option.schema';

export interface IKanbanView extends IViewVo {
  type: ViewType.Kanban;
  options: IKanbanViewOptions;
}

export class KanbanViewCore extends ViewCore {
  type!: ViewType.Kanban;

  options!: IKanbanViewOptions;

  columnMeta!: IKanbanColumnMeta;
}
