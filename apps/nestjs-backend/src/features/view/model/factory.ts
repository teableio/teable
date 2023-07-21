import type { IViewRo, IViewVo } from '@teable-group/core';
import { assertNever, generateViewId, ViewType } from '@teable-group/core';
import type { View } from '@teable-group/db-main-prisma';
import { plainToInstance } from 'class-transformer';
import { GridViewDto } from './grid-view.dto';
import { KanbanViewDto } from './kanban-view.dto';

export function createViewInstanceByRaw(viewRaw: View) {
  const view: IViewVo = {
    id: viewRaw.id,
    name: viewRaw.name,
    type: viewRaw.type as ViewType,
    description: viewRaw.description || undefined,
    options: JSON.parse(viewRaw.options as string) || undefined,
    filter: JSON.parse(viewRaw.filter as string) || undefined,
    sort: JSON.parse(viewRaw.sort as string) || undefined,
    group: JSON.parse(viewRaw.group as string) || undefined,
    order: viewRaw.order,
  };

  switch (view.type) {
    case ViewType.Grid:
      return plainToInstance(GridViewDto, view);
    case ViewType.Kanban:
      return plainToInstance(KanbanViewDto, view);
    case ViewType.Form:
    case ViewType.Gallery:
    case ViewType.Gantt:
    case ViewType.Calendar:
      throw new Error('did not implement yet');
    default:
      assertNever(view.type);
  }
}

export function createViewInstanceByRo(createViewRo: IViewRo & { id?: string }) {
  // generate Id first
  const view: IViewRo = createViewRo.id ? createViewRo : { ...createViewRo, id: generateViewId() };

  switch (view.type) {
    case ViewType.Grid:
      return plainToInstance(GridViewDto, view);
    case ViewType.Kanban:
      return plainToInstance(KanbanViewDto, view);
    case ViewType.Form:
    case ViewType.Gallery:
    case ViewType.Gantt:
    case ViewType.Calendar:
      throw new Error('did not implement yet');
    default:
      assertNever(view.type);
  }
}

export type IViewInstance = ReturnType<typeof createViewInstanceByRaw>;
