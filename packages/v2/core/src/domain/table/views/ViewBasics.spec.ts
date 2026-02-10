import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { CalendarView } from './types/CalendarView';
import { FormView } from './types/FormView';
import { GalleryView } from './types/GalleryView';
import { GridView } from './types/GridView';
import { KanbanView } from './types/KanbanView';
import { PluginView } from './types/PluginView';
import {
  createCalendarView,
  createFormView,
  createGalleryView,
  createGridView,
  createKanbanView,
  createPluginView,
} from './ViewFactory';
import { ViewId } from './ViewId';
import { ViewName } from './ViewName';
import type { IViewVisitor } from './visitors/IViewVisitor';
import { NoopViewVisitor } from './visitors/NoopViewVisitor';

const createViewId = (seed: string) => ViewId.create(`viw${seed.repeat(16)}`);

class RecordingViewVisitor implements IViewVisitor<string> {
  visitGridView(): ReturnType<IViewVisitor<string>['visitGridView']> {
    return ok('grid');
  }
  visitKanbanView(): ReturnType<IViewVisitor<string>['visitKanbanView']> {
    return ok('kanban');
  }
  visitGalleryView(): ReturnType<IViewVisitor<string>['visitGalleryView']> {
    return ok('gallery');
  }
  visitCalendarView(): ReturnType<IViewVisitor<string>['visitCalendarView']> {
    return ok('calendar');
  }
  visitFormView(): ReturnType<IViewVisitor<string>['visitFormView']> {
    return ok('form');
  }
  visitPluginView(): ReturnType<IViewVisitor<string>['visitPluginView']> {
    return ok('plugin');
  }
}

describe('ViewName', () => {
  it('validates view names', () => {
    ViewName.create('Grid')._unsafeUnwrap();
    ViewName.create('')._unsafeUnwrapErr();
  });

  it('compares view names by value', () => {
    const left = ViewName.create('A');
    const right = ViewName.create('A');
    const other = ViewName.create('B');
    const leftName = left._unsafeUnwrap();
    const rightName = right._unsafeUnwrap();
    const otherName = other._unsafeUnwrap();
    expect(leftName.equals(rightName)).toBe(true);
    expect(leftName.equals(otherName)).toBe(false);
  });
});

describe('View types and visitors', () => {
  it('creates view types and accepts visitors', () => {
    const idResult = createViewId('a');
    const nameResult = ViewName.create('Grid');
    [idResult, nameResult].forEach((r) => r._unsafeUnwrap());
    idResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();

    const id = idResult._unsafeUnwrap();
    const name = nameResult._unsafeUnwrap();
    const visitor = new RecordingViewVisitor();

    const grid = GridView.create({ id, name });
    const kanban = KanbanView.create({ id, name });
    const gallery = GalleryView.create({ id, name });
    const calendar = CalendarView.create({ id, name });
    const form = FormView.create({ id, name });
    const plugin = PluginView.create({ id, name });

    const gridView = grid._unsafeUnwrap();
    const kanbanView = kanban._unsafeUnwrap();
    const galleryView = gallery._unsafeUnwrap();
    const calendarView = calendar._unsafeUnwrap();
    const formView = form._unsafeUnwrap();
    const pluginView = plugin._unsafeUnwrap();

    const gridAccept = gridView.accept(visitor);
    gridAccept._unsafeUnwrap();

    expect(gridAccept._unsafeUnwrap()).toBe('grid');

    const kanbanAccept = kanbanView.accept(visitor);
    kanbanAccept._unsafeUnwrap();

    expect(kanbanAccept._unsafeUnwrap()).toBe('kanban');

    const galleryAccept = galleryView.accept(visitor);
    galleryAccept._unsafeUnwrap();

    expect(galleryAccept._unsafeUnwrap()).toBe('gallery');

    const calendarAccept = calendarView.accept(visitor);
    calendarAccept._unsafeUnwrap();

    expect(calendarAccept._unsafeUnwrap()).toBe('calendar');

    const formAccept = formView.accept(visitor);
    formAccept._unsafeUnwrap();

    expect(formAccept._unsafeUnwrap()).toBe('form');

    const pluginAccept = pluginView.accept(visitor);
    pluginAccept._unsafeUnwrap();

    expect(pluginAccept._unsafeUnwrap()).toBe('plugin');

    const noopVisitor = new NoopViewVisitor();
    gridView.accept(noopVisitor)._unsafeUnwrap();
  });

  it('creates views via factory helpers', () => {
    const idResult = createViewId('b');
    const nameResult = ViewName.create('All Records');
    [idResult, nameResult].forEach((r) => r._unsafeUnwrap());
    idResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();

    const params = { id: idResult._unsafeUnwrap(), name: nameResult._unsafeUnwrap() };
    const results = [
      createGridView(params),
      createKanbanView(params),
      createGalleryView(params),
      createCalendarView(params),
      createFormView(params),
      createPluginView(params),
    ];
    results.forEach((r) => r._unsafeUnwrap());
  });
});
