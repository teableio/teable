import type { Result } from 'neverthrow';

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
import type { IViewVisitor } from './IViewVisitor';

export class CloneViewVisitor implements IViewVisitor<View> {
  visitGridView(view: GridView): Result<View, string> {
    return createGridView({ id: view.id(), name: view.name() });
  }

  visitKanbanView(view: KanbanView): Result<View, string> {
    return createKanbanView({ id: view.id(), name: view.name() });
  }

  visitGalleryView(view: GalleryView): Result<View, string> {
    return createGalleryView({ id: view.id(), name: view.name() });
  }

  visitCalendarView(view: CalendarView): Result<View, string> {
    return createCalendarView({ id: view.id(), name: view.name() });
  }

  visitFormView(view: FormView): Result<View, string> {
    return createFormView({ id: view.id(), name: view.name() });
  }

  visitPluginView(view: PluginView): Result<View, string> {
    return createPluginView({ id: view.id(), name: view.name() });
  }
}
