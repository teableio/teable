import type { IViewVo } from '@teable/core';
import { assertNever, ViewType } from '@teable/core';
import type { View } from '@teable/db-main-prisma';
import { plainToInstance } from 'class-transformer';
import { CalendarViewDto } from './calendar-view.dto';
import { FormViewDto } from './form-view.dto';
import { GalleryViewDto } from './gallery-view.dto';
import { GridViewDto } from './grid-view.dto';
import { KanbanViewDto } from './kanban-view.dto';
import { PluginViewDto } from './plugin-view.dto';

export function createViewInstanceByRaw(viewRaw: View) {
  const viewVo = createViewVoByRaw(viewRaw);

  switch (viewVo.type) {
    case ViewType.Grid:
      return plainToInstance(GridViewDto, viewVo);
    case ViewType.Kanban:
      return plainToInstance(KanbanViewDto, viewVo);
    case ViewType.Gallery:
      return plainToInstance(GalleryViewDto, viewVo);
    case ViewType.Calendar:
      return plainToInstance(CalendarViewDto, viewVo);
    case ViewType.Form:
      return plainToInstance(FormViewDto, viewVo);
    case ViewType.Plugin:
      return plainToInstance(PluginViewDto, viewVo);
    case ViewType.Gantt:
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
    shareId: viewRaw.shareId || undefined,
    shareMeta: JSON.parse(viewRaw.shareMeta as string) || undefined,
    enableShare: viewRaw.enableShare || undefined,
    createdBy: viewRaw.createdBy,
    lastModifiedBy: viewRaw.lastModifiedBy || undefined,
    createdTime: viewRaw.createdTime.toISOString(),
    lastModifiedTime: viewRaw.lastModifiedTime ? viewRaw.lastModifiedTime.toISOString() : undefined,
    columnMeta: JSON.parse(viewRaw.columnMeta as string) || undefined,
  };
}

export type IViewInstance = ReturnType<typeof createViewInstanceByRaw>;
