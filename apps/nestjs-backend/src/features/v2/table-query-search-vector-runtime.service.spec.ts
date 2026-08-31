import { v2TableOpsTokens } from '@teable/v2-table-query-ops';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  TableQuerySearchVectorRuntimeService,
  hasSearchValueForSearchVectorRuntime,
  resolveTableQuerySearchVectorRuntimeMode,
} from './table-query-search-vector-runtime.service';

describe('TableQuerySearchVectorRuntimeService', () => {
  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['off', 'off'],
    ['false', 'off'],
    ['auto', 'auto'],
    ['true', 'auto'],
    ['enabled', 'auto'],
    [true, 'auto'],
  ] as const)('resolves runtime mode %s as %s', (input, expected) => {
    expect(resolveTableQuerySearchVectorRuntimeMode(input)).toBe(expected);
  });

  it.each([
    [undefined, false],
    [[], false],
    [[''], false],
    [['   '], false],
    [['order 123'], true],
  ] as const)('resolves runtime search usability for %j as %s', (search, expected) => {
    expect(hasSearchValueForSearchVectorRuntime(search)).toBe(expected);
  });

  it('does not consult the resolver when the global runtime gate is off', async () => {
    const service = new TableQuerySearchVectorRuntimeService({
      get: vi.fn().mockReturnValue('off'),
    } as never);
    const container = {
      isRegistered: vi.fn(),
    };

    await expect(
      service.resolveForRecordSearch({
        container: container as never,
        tableId: `tbl${'a'.repeat(16)}`,
        search: ['order 123'],
      })
    ).resolves.toBeUndefined();
    expect(container.isRegistered).not.toHaveBeenCalled();
  });

  it('delegates to the registered search access path resolver port', async () => {
    const accessPath = {
      kind: 'generated_text' as const,
      generatedColumnName: '__tqops_search_document',
      provider: 'pg_trgm' as const,
      searchScope: 'all_fields' as const,
      coveredFieldIds: [],
    };
    const resolve = vi.fn().mockResolvedValue(ok(accessPath));
    const container = {
      isRegistered: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockReturnValue({ resolve }),
    };
    const service = new TableQuerySearchVectorRuntimeService({
      get: vi.fn().mockReturnValue('auto'),
    } as never);

    await expect(
      service.resolveForRecordSearch({
        container: container as never,
        tableId: `tbl${'a'.repeat(16)}`,
        search: ['order 123'],
      })
    ).resolves.toBe(accessPath);
    expect(container.isRegistered).toHaveBeenCalledWith(v2TableOpsTokens.searchAccessPathResolver);
    expect(resolve).toHaveBeenCalledWith(expect.anything(), `tbl${'a'.repeat(16)}`);
  });

  it('returns undefined when the resolver port is not registered', async () => {
    const container = {
      isRegistered: vi.fn().mockReturnValue(false),
      resolve: vi.fn(),
    };
    const service = new TableQuerySearchVectorRuntimeService({
      get: vi.fn().mockReturnValue('auto'),
    } as never);

    await expect(
      service.resolveForRecordSearch({
        container: container as never,
        tableId: `tbl${'a'.repeat(16)}`,
        search: ['order 123'],
      })
    ).resolves.toBeUndefined();
    expect(container.resolve).not.toHaveBeenCalled();
  });
});
