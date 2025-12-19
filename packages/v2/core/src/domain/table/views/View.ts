import type { Result } from 'neverthrow';

import { Entity } from '../../shared/Entity';
import type { ViewId } from './ViewId';
import type { ViewName } from './ViewName';
import type { ViewType } from './ViewType';
import type { IViewVisitor } from './visitors/IViewVisitor';

export abstract class View extends Entity<ViewId> {
  protected constructor(
    id: ViewId,
    private readonly nameValue: ViewName,
    private readonly typeValue: ViewType
  ) {
    super(id);
  }

  name(): ViewName {
    return this.nameValue;
  }

  type(): ViewType {
    return this.typeValue;
  }

  abstract accept<T = void>(visitor: IViewVisitor<T>): Result<T, string>;
}
