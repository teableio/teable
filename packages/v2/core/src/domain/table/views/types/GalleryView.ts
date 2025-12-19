import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { View } from '../View';
import type { ViewId } from '../ViewId';
import type { ViewName } from '../ViewName';
import { ViewType } from '../ViewType';
import type { IViewVisitor } from '../visitors/IViewVisitor';

export class GalleryView extends View {
  private constructor(id: ViewId, name: ViewName) {
    super(id, name, ViewType.gallery());
  }

  static create(params: { id: ViewId; name: ViewName }): Result<GalleryView, string> {
    return ok(new GalleryView(params.id, params.name));
  }

  accept<T = void>(visitor: IViewVisitor<T>): Result<T, string> {
    return visitor.visitGalleryView(this);
  }
}
