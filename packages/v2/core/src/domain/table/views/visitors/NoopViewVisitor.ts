import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { CalendarView } from '../types/CalendarView';
import type { FormView } from '../types/FormView';
import type { GalleryView } from '../types/GalleryView';
import type { GridView } from '../types/GridView';
import type { KanbanView } from '../types/KanbanView';
import type { PluginView } from '../types/PluginView';
import type { IViewVisitor } from './IViewVisitor';

export class NoopViewVisitor implements IViewVisitor {
  visitGridView(_: GridView): Result<void, DomainError> {
    return ok(undefined);
  }

  visitKanbanView(_: KanbanView): Result<void, DomainError> {
    return ok(undefined);
  }

  visitGalleryView(_: GalleryView): Result<void, DomainError> {
    return ok(undefined);
  }

  visitCalendarView(_: CalendarView): Result<void, DomainError> {
    return ok(undefined);
  }

  visitFormView(_: FormView): Result<void, DomainError> {
    return ok(undefined);
  }

  visitPluginView(_: PluginView): Result<void, DomainError> {
    return ok(undefined);
  }
}
