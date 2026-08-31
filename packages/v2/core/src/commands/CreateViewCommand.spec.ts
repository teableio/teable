import { describe, expect, it } from 'vitest';

import { CreateViewCommand } from './CreateViewCommand';

describe('CreateViewCommand', () => {
  it('parses the v2 create-view input', () => {
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: {
        name: 'Planning',
        type: 'grid',
        columnMeta: {
          [`fld${'c'.repeat(16)}`]: { order: 0, width: 240 },
        },
        options: { rowHeight: 'short' },
        description: 'Planning details',
        filter: {
          conjunction: 'and',
          items: [
            {
              fieldId: `fld${'c'.repeat(16)}`,
              operator: 'is',
              value: 'alpha',
            },
          ],
        },
        sort: [{ fieldId: `fld${'c'.repeat(16)}`, order: 'desc' }],
        group: [{ fieldId: `fld${'c'.repeat(16)}`, order: 'asc' }],
        manualSort: false,
        isLocked: true,
        enableShare: true,
        shareId: 'shr-planning',
        shareMeta: { allowCopy: false },
      },
    });

    expect(result.isOk()).toBe(true);
    const command = result._unsafeUnwrap();
    expect(command.view.type).toBe('grid');
    expect(command.view.name).toBe('Planning');
    expect(command.view.description).toBe('Planning details');
    expect(command.view.isLocked).toBe(true);
  });

  it('rejects an unsupported view type', () => {
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: { type: 'timeline' },
    });

    expect(result.isErr()).toBe(true);
  });

  it('rejects a share password shorter than the public contract minimum', () => {
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: {
        type: 'grid',
        shareMeta: { password: 'ab' },
      },
    });

    expect(result.isErr()).toBe(true);
  });

  it('accepts an empty filter group for the legacy View contract', () => {
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: {
        type: 'grid',
        filter: { conjunction: 'and', items: [] },
      },
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().view.filter).toEqual({
      conjunction: 'and',
      items: [],
    });
  });

  it('rejects an unvalidated source-filter metadata payload', () => {
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: {
        type: 'grid',
        sourceFilter: {
          conjunction: 'and',
          filterSet: [{ arbitraryMetadata: 'must not persist' }],
        },
      },
    });

    expect(result.isErr()).toBe(true);
  });

  it('derives the canonical filter when only the public source filter is provided', () => {
    const fieldId = `fld${'c'.repeat(16)}`;
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: {
        type: 'grid',
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId,
              operator: 'IN',
              isSymbol: true,
              value: 'alpha',
            },
          ],
        },
      },
    });

    expect(result._unsafeUnwrap().view.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId, operator: 'isAnyOf', value: ['alpha'] }],
    });
  });

  it('uses the source filter as the single authority when a mismatched canonical filter is passed', () => {
    const fieldId = `fld${'c'.repeat(16)}`;
    const result = CreateViewCommand.create({
      tableId: `tbl${'b'.repeat(16)}`,
      view: {
        type: 'grid',
        filter: { fieldId, operator: 'is', value: 'mismatched' },
        sourceFilter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId,
              operator: '=',
              isSymbol: true,
              value: 'authoritative',
            },
          ],
        },
      },
    });

    expect(result._unsafeUnwrap().view.filter).toEqual({
      conjunction: 'and',
      items: [{ fieldId, operator: 'is', value: 'authoritative' }],
    });
  });
});
