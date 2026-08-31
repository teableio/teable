import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { View } from '../View';
import type { ViewId } from '../ViewId';
import type { ViewName } from '../ViewName';
import type { ViewProperties } from '../ViewProperties';
import { ViewType } from '../ViewType';
import type { IViewVisitor } from '../visitors/IViewVisitor';

export class GalleryView extends View {
  private constructor(id: ViewId, name: ViewName, properties?: ViewProperties) {
    super(id, name, ViewType.gallery(), properties);
  }

  static create(params: {
    id: ViewId;
    name: ViewName;
    properties?: ViewProperties;
  }): Result<GalleryView, DomainError> {
    return ok(new GalleryView(params.id, params.name, params.properties));
  }

  accept<T = void>(visitor: IViewVisitor<T>): Result<T, DomainError> {
    return visitor.visitGalleryView(this);
  }
}
