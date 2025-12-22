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
    expect(ViewName.create('Grid').isOk()).toBe(true);
    expect(ViewName.create('').isErr()).toBe(true);
  });

  it('compares view names by value', () => {
    const left = ViewName.create('A');
    const right = ViewName.create('A');
    const other = ViewName.create('B');
    expect([left, right, other].every((r) => r.isOk())).toBe(true);
    if (left.isErr() || right.isErr() || other.isErr()) return;
    expect(left.value.equals(right.value)).toBe(true);
    expect(left.value.equals(other.value)).toBe(false);
  });
});

describe('View types and visitors', () => {
  it('creates view types and accepts visitors', () => {
    const idResult = createViewId('a');
    const nameResult = ViewName.create('Grid');
    expect([idResult, nameResult].every((r) => r.isOk())).toBe(true);
    if (idResult.isErr() || nameResult.isErr()) return;

    const id = idResult.value;
    const name = nameResult.value;
    const visitor = new RecordingViewVisitor();

    const grid = GridView.create({ id, name });
    const kanban = KanbanView.create({ id, name });
    const gallery = GalleryView.create({ id, name });
    const calendar = CalendarView.create({ id, name });
    const form = FormView.create({ id, name });
    const plugin = PluginView.create({ id, name });

    expect([grid, kanban, gallery, calendar, form, plugin].every((r) => r.isOk())).toBe(true);
    if (
      grid.isErr() ||
      kanban.isErr() ||
      gallery.isErr() ||
      calendar.isErr() ||
      form.isErr() ||
      plugin.isErr()
    )
      return;

    const gridAccept = grid.value.accept(visitor);
    expect(gridAccept.isOk()).toBe(true);
    if (gridAccept.isErr()) return;
    expect(gridAccept.value).toBe('grid');

    const kanbanAccept = kanban.value.accept(visitor);
    expect(kanbanAccept.isOk()).toBe(true);
    if (kanbanAccept.isErr()) return;
    expect(kanbanAccept.value).toBe('kanban');

    const galleryAccept = gallery.value.accept(visitor);
    expect(galleryAccept.isOk()).toBe(true);
    if (galleryAccept.isErr()) return;
    expect(galleryAccept.value).toBe('gallery');

    const calendarAccept = calendar.value.accept(visitor);
    expect(calendarAccept.isOk()).toBe(true);
    if (calendarAccept.isErr()) return;
    expect(calendarAccept.value).toBe('calendar');

    const formAccept = form.value.accept(visitor);
    expect(formAccept.isOk()).toBe(true);
    if (formAccept.isErr()) return;
    expect(formAccept.value).toBe('form');

    const pluginAccept = plugin.value.accept(visitor);
    expect(pluginAccept.isOk()).toBe(true);
    if (pluginAccept.isErr()) return;
    expect(pluginAccept.value).toBe('plugin');

    const noopVisitor = new NoopViewVisitor();
    expect(grid.value.accept(noopVisitor).isOk()).toBe(true);
  });

  it('creates views via factory helpers', () => {
    const idResult = createViewId('b');
    const nameResult = ViewName.create('All Records');
    expect([idResult, nameResult].every((r) => r.isOk())).toBe(true);
    if (idResult.isErr() || nameResult.isErr()) return;

    const params = { id: idResult.value, name: nameResult.value };
    const results = [
      createGridView(params),
      createKanbanView(params),
      createGalleryView(params),
      createCalendarView(params),
      createFormView(params),
      createPluginView(params),
    ];
    expect(results.every((r) => r.isOk())).toBe(true);
  });
});
