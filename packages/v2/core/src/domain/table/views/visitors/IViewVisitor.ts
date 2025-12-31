import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { CalendarView } from '../types/CalendarView';
import type { FormView } from '../types/FormView';
import type { GalleryView } from '../types/GalleryView';
import type { GridView } from '../types/GridView';
import type { KanbanView } from '../types/KanbanView';
import type { PluginView } from '../types/PluginView';

export interface IViewVisitor<T = void> {
  visitGridView(view: GridView): Result<T, DomainError>;
  visitKanbanView(view: KanbanView): Result<T, DomainError>;
  visitGalleryView(view: GalleryView): Result<T, DomainError>;
  visitCalendarView(view: CalendarView): Result<T, DomainError>;
  visitFormView(view: FormView): Result<T, DomainError>;
  visitPluginView(view: PluginView): Result<T, DomainError>;
}
