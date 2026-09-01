import { describe, expect, it } from 'vitest';

import { viewReadDtoSchema } from './viewReadDto';

const baseView = {
  id: `viw${'a'.repeat(16)}`,
  name: 'View',
  createdBy: 'system',
  createdTime: '2026-07-31T00:00:00.000Z',
  columnMeta: {},
};

describe('viewReadDtoSchema', () => {
  it.each(['grid', 'kanban', 'gallery', 'calendar', 'form', 'plugin'] as const)(
    'accepts the %s View subtype',
    (type) => {
      const result = viewReadDtoSchema.safeParse({ ...baseView, type });

      expect(result.success).toBe(true);
    }
  );

  it('preserves the complete public View projection', () => {
    const result = viewReadDtoSchema.parse({
      ...baseView,
      version: 3,
      type: 'grid',
      description: 'Planning',
      order: 2,
      options: { rowHeight: 'short' },
      filter: { conjunction: 'and', filterSet: [] },
      sort: {
        sortObjs: [{ fieldId: 'fldTitle', order: 'asc' }],
        manualSort: false,
      },
      group: [{ fieldId: 'fldStatus', order: 'desc' }],
      isLocked: true,
      shareId: 'shrCredential',
      enableShare: true,
      shareMeta: {
        allowCopy: false,
        includeHiddenField: true,
        includeRecords: true,
        password: 'secret',
        submit: { requireLogin: true },
        allowEdit: true,
      },
      lastModifiedBy: 'editor',
      lastModifiedTime: '2026-07-31T01:00:00.000Z',
      columnMeta: {
        fldTitle: { order: 0, width: 240, custom: 'preserved' },
      },
    });

    expect(result).toMatchObject({
      version: 3,
      shareId: 'shrCredential',
      sort: { manualSort: false },
      columnMeta: {
        fldTitle: { custom: 'preserved' },
      },
    });
  });

  it('rejects an unknown View subtype', () => {
    const result = viewReadDtoSchema.safeParse({ ...baseView, type: 'timeline' });

    expect(result.success).toBe(false);
  });

  it('rejects malformed sort and group directions', () => {
    const result = viewReadDtoSchema.safeParse({
      ...baseView,
      type: 'grid',
      sort: { sortObjs: [{ fieldId: 'fldTitle', order: 'sideways' }] },
      group: [{ fieldId: 'fldStatus', order: 'sideways' }],
    });

    expect(result.success).toBe(false);
  });
});
