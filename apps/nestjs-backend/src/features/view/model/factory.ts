import { assertNever, generateViewId, ViewType } from '@teable-group/core';
import type { View } from '@teable-group/db-main-prisma';
import { plainToInstance } from 'class-transformer';
import type { CreateViewRo } from './create-view.ro';
import { GridViewDto } from './grid-view.dto';
import { KanbanViewDto } from './kanban-view.dto';
import type { ViewVo } from './view.vo';

export function createViewInstanceByRaw(viewRaw: View) {
  const view: ViewVo = {
    id: viewRaw.id,
    name: viewRaw.name,
    type: viewRaw.type as ViewType,
    description: viewRaw.description || undefined,
    options: viewRaw.options && JSON.parse(viewRaw.options as string),
    filter: viewRaw.filter && JSON.parse(viewRaw.filter as string),
    sort: viewRaw.filter && JSON.parse(viewRaw.sort as string),
    group: viewRaw.group && JSON.parse(viewRaw.group as string),
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

export function createViewInstanceByRo(createViewRo: CreateViewRo & { id?: string }) {
  // generate Id first
  const view: CreateViewRo = createViewRo.id
    ? createViewRo
    : { ...createViewRo, id: generateViewId() };

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
