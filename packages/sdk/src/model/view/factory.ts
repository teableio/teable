import type { IViewVo } from '@teable/core';
import { assertNever, ViewType } from '@teable/core';
import { plainToInstance } from 'class-transformer';
import type { Doc } from 'sharedb/lib/client';
import { CalendarView } from './calendar.view';
import { FormView } from './form.view';
import { GalleryView } from './gallery.view';
import { GridView } from './grid.view';
import { KanbanView } from './kanban.view';
import { PluginView } from './plugin.view';

export function createViewInstance(view: IViewVo, doc?: Doc<IViewVo>) {
  const instance = (() => {
    switch (view.type) {
      case ViewType.Grid:
        return plainToInstance(GridView, view);
      case ViewType.Kanban:
        return plainToInstance(KanbanView, view);
      case ViewType.Form:
        return plainToInstance(FormView, view);
      case ViewType.Gallery:
        return plainToInstance(GalleryView, view);
      case ViewType.Plugin:
        return plainToInstance(PluginView, view);
      case ViewType.Calendar:
        return plainToInstance(CalendarView, view);
      case ViewType.Gantt:
        throw new Error('did not implement yet');
      default:
        assertNever(view.type);
    }
  })();

  // force inject object into instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const temp: any = instance;
  temp.doc = doc;
  temp.tableId = doc?.collection.split('_')[1];
  return instance;
}

export type IViewInstance = ReturnType<typeof createViewInstance>;
