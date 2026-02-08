import type { Result } from 'neverthrow';

import type { DomainError } from '../../shared/DomainError';
import { CalendarView } from './types/CalendarView';
import { FormView } from './types/FormView';
import { GalleryView } from './types/GalleryView';
import { GridView } from './types/GridView';
import { KanbanView } from './types/KanbanView';
import { PluginView } from './types/PluginView';
import type { View } from './View';
import type { ViewId } from './ViewId';
import type { ViewName } from './ViewName';

export const createGridView = (params: { id: ViewId; name: ViewName }): Result<View, DomainError> =>
  GridView.create(params);

export const createKanbanView = (params: {
  id: ViewId;
  name: ViewName;
}): Result<View, DomainError> => KanbanView.create(params);

export const createGalleryView = (params: {
  id: ViewId;
  name: ViewName;
}): Result<View, DomainError> => GalleryView.create(params);

export const createCalendarView = (params: {
  id: ViewId;
  name: ViewName;
}): Result<View, DomainError> => CalendarView.create(params);

export const createFormView = (params: { id: ViewId; name: ViewName }): Result<View, DomainError> =>
  FormView.create(params);

export const createPluginView = (params: {
  id: ViewId;
  name: ViewName;
}): Result<View, DomainError> => PluginView.create(params);
