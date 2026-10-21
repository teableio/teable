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
import type { ViewProperties } from './ViewProperties';
import type { IViewTypeLiteral } from './ViewType';

export type ViewFactoryParams = { id: ViewId; name: ViewName; properties?: ViewProperties };
export type TypedViewFactoryParams = ViewFactoryParams & { type: IViewTypeLiteral };

export const createView = (params: TypedViewFactoryParams): Result<View, DomainError> => {
  switch (params.type) {
    case 'grid':
      return createGridView(params);
    case 'calendar':
      return createCalendarView(params);
    case 'kanban':
      return createKanbanView(params);
    case 'form':
      return createFormView(params);
    case 'gallery':
      return createGalleryView(params);
    case 'plugin':
      return createPluginView(params);
  }
};

export const createGridView = (params: ViewFactoryParams): Result<View, DomainError> =>
  GridView.create(params);

export const createKanbanView = (params: ViewFactoryParams): Result<View, DomainError> =>
  KanbanView.create(params);

export const createGalleryView = (params: ViewFactoryParams): Result<View, DomainError> =>
  GalleryView.create(params);

export const createCalendarView = (params: ViewFactoryParams): Result<View, DomainError> =>
  CalendarView.create(params);

export const createFormView = (params: ViewFactoryParams): Result<View, DomainError> =>
  FormView.create(params);

export const createPluginView = (params: ViewFactoryParams): Result<View, DomainError> =>
  PluginView.create(params);
