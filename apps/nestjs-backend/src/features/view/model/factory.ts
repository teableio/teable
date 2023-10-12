import type { IViewVo } from '@teable-group/core';
import { assertNever, ViewType } from '@teable-group/core';
import type { View } from '@teable-group/db-main-prisma';
import { plainToInstance } from 'class-transformer';
import { GridViewDto } from './grid-view.dto';
import { KanbanViewDto } from './kanban-view.dto';

export function createViewInstanceByRaw(viewRaw: View) {
  const viewVo = createViewVoByRaw(viewRaw);

  switch (viewVo.type) {
    case ViewType.Grid:
      return plainToInstance(GridViewDto, viewVo);
    case ViewType.Kanban:
      return plainToInstance(KanbanViewDto, viewVo);
    case ViewType.Form:
    case ViewType.Gallery:
    case ViewType.Gantt:
    case ViewType.Calendar:
      throw new Error('did not implement yet');
    default:
      assertNever(viewVo.type);
  }
}

export function createViewVoByRaw(viewRaw: View): IViewVo {
  return {
    id: viewRaw.id,
    name: viewRaw.name,
    type: viewRaw.type as ViewType,
    description: viewRaw.description || undefined,
    options: JSON.parse(viewRaw.options as string) || undefined,
    filter: JSON.parse(viewRaw.filter as string) || undefined,
    sort: JSON.parse(viewRaw.sort as string) || undefined,
    group: JSON.parse(viewRaw.group as string) || undefined,
    order: viewRaw.order,
    createdBy: viewRaw.createdBy,
    lastModifiedBy: viewRaw.lastModifiedBy,
    createdTime: viewRaw.createdTime.toISOString(),
    lastModifiedTime: viewRaw.lastModifiedTime.toISOString(),
  };
}

export type IViewInstance = ReturnType<typeof createViewInstanceByRaw>;
