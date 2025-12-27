import { describe, expect, it } from 'vitest';

import { ViewType } from './ViewType';

describe('ViewType', () => {
  it('accepts known view types', () => {
    const types = ['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin'] as const;
    for (const type of types) {
      ViewType.create(type)._unsafeUnwrap();
    }
  });

  it('rejects unknown view types', () => {
    ViewType.create('unknown')._unsafeUnwrapErr();
  });

  it('creates view types via constructors', () => {
    expect(ViewType.grid().toString()).toBe('grid');
    expect(ViewType.calendar().toString()).toBe('calendar');
    expect(ViewType.kanban().toString()).toBe('kanban');
    expect(ViewType.form().toString()).toBe('form');
    expect(ViewType.gallery().toString()).toBe('gallery');
    expect(ViewType.plugin().toString()).toBe('plugin');
  });
});
