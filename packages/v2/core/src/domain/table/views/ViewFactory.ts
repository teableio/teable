import type { Result } from 'neverthrow';

import { CalendarView } from './types/CalendarView';
import { FormView } from './types/FormView';
import { GalleryView } from './types/GalleryView';
import { GridView } from './types/GridView';
import { KanbanView } from './types/KanbanView';
import { PluginView } from './types/PluginView';
import type { View } from './View';
import type { ViewId } from './ViewId';
import type { ViewName } from './ViewName';

export const createGridView = (params: { id: ViewId; name: ViewName }): Result<View, string> =>
  GridView.create(params);

export const createKanbanView = (params: { id: ViewId; name: ViewName }): Result<View, string> =>
  KanbanView.create(params);

export const createGalleryView = (params: { id: ViewId; name: ViewName }): Result<View, string> =>
  GalleryView.create(params);

export const createCalendarView = (params: { id: ViewId; name: ViewName }): Result<View, string> =>
  CalendarView.create(params);

export const createFormView = (params: { id: ViewId; name: ViewName }): Result<View, string> =>
  FormView.create(params);

export const createPluginView = (params: { id: ViewId; name: ViewName }): Result<View, string> =>
  PluginView.create(params);
