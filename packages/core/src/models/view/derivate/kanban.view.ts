import type { ViewType } from '../constant';
import type { IViewVo } from '../interface';
import { ViewCore } from '../view';

export interface IKanbanView extends IViewVo {
  type: ViewType.Kanban;
  options: KanbanViewOptions;
}

export class KanbanViewOptions {
  groupingFieldId!: string;
}

export class KanbanViewCore extends ViewCore {
  type!: ViewType.Kanban;

  options!: KanbanViewOptions;
}
