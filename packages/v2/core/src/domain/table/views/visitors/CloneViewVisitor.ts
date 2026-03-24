import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { CalendarView } from '../types/CalendarView';
import type { FormView } from '../types/FormView';
import type { GalleryView } from '../types/GalleryView';
import type { GridView } from '../types/GridView';
import type { KanbanView } from '../types/KanbanView';
import type { PluginView } from '../types/PluginView';
import type { View } from '../View';
import {
  createCalendarView,
  createFormView,
  createGalleryView,
  createGridView,
  createKanbanView,
  createPluginView,
} from '../ViewFactory';
import type { ViewId } from '../ViewId';
import type { ViewName } from '../ViewName';
import type { IViewVisitor } from './IViewVisitor';

export class CloneViewVisitor implements IViewVisitor<View> {
  visitGridView(view: GridView): Result<View, DomainError> {
    return this.cloneView(view, createGridView);
  }

  visitKanbanView(view: KanbanView): Result<View, DomainError> {
    return this.cloneView(view, createKanbanView);
  }

  visitGalleryView(view: GalleryView): Result<View, DomainError> {
    return this.cloneView(view, createGalleryView);
  }

  visitCalendarView(view: CalendarView): Result<View, DomainError> {
    return this.cloneView(view, createCalendarView);
  }

  visitFormView(view: FormView): Result<View, DomainError> {
    return this.cloneView(view, createFormView);
  }

  visitPluginView(view: PluginView): Result<View, DomainError> {
    return this.cloneView(view, createPluginView);
  }

  private cloneView(
    view: View,
    factory: (params: { id: ViewId; name: ViewName }) => Result<View, DomainError>
  ): Result<View, DomainError> {
    return factory({ id: view.id(), name: view.name() }).andThen((clone) =>
      clone.setOptions(view.options()).map(() => clone)
    );
  }
}
