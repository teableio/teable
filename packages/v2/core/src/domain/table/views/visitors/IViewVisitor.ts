import type { Result } from 'neverthrow';

import type { CalendarView } from '../types/CalendarView';
import type { FormView } from '../types/FormView';
import type { GalleryView } from '../types/GalleryView';
import type { GridView } from '../types/GridView';
import type { KanbanView } from '../types/KanbanView';
import type { PluginView } from '../types/PluginView';

export interface IViewVisitor<T = void> {
  visitGridView(view: GridView): Result<T, string>;
  visitKanbanView(view: KanbanView): Result<T, string>;
  visitGalleryView(view: GalleryView): Result<T, string>;
  visitCalendarView(view: CalendarView): Result<T, string>;
  visitFormView(view: FormView): Result<T, string>;
  visitPluginView(view: PluginView): Result<T, string>;
}
