import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { View } from '../View';
import type { ViewId } from '../ViewId';
import type { ViewName } from '../ViewName';
import { ViewType } from '../ViewType';
import type { IViewVisitor } from '../visitors/IViewVisitor';

export class KanbanView extends View {
  private constructor(id: ViewId, name: ViewName) {
    super(id, name, ViewType.kanban());
  }

  static create(params: { id: ViewId; name: ViewName }): Result<KanbanView, string> {
    return ok(new KanbanView(params.id, params.name));
  }

  accept<T = void>(visitor: IViewVisitor<T>): Result<T, string> {
    return visitor.visitKanbanView(this);
  }
}
