import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { View } from '../View';
import type { ViewId } from '../ViewId';
import type { ViewName } from '../ViewName';
import { ViewType } from '../ViewType';
import type { IViewVisitor } from '../visitors/IViewVisitor';

export class PluginView extends View {
  private constructor(id: ViewId, name: ViewName) {
    super(id, name, ViewType.plugin());
  }

  static create(params: { id: ViewId; name: ViewName }): Result<PluginView, string> {
    return ok(new PluginView(params.id, params.name));
  }

  accept<T = void>(visitor: IViewVisitor<T>): Result<T, string> {
    return visitor.visitPluginView(this);
  }
}
