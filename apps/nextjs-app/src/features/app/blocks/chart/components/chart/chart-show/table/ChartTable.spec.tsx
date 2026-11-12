import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { BaseQueryColumnType, PluginPosition } from '@teable/openapi';
import type { IBaseQueryVo } from '@teable/openapi';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartTable } from './ChartTable';

const env = vi.hoisted(() => ({
  baseId: 'bseChartTest',
  tableId: 'tblChartTest',
  positionId: 'dshChartTest',
  pluginInstallId: 'pliChartTest',
  positionType: 'dashboard',
}));

vi.mock('../../../../hooks/useEnv', () => ({ useEnv: () => env }));

const textField: IFieldVo = {
  id: 'fldLabel',
  name: 'Label',
  type: FieldType.SingleLineText,
  dbFieldName: 'label',
  dbFieldType: DbFieldType.Text,
  cellValueType: CellValueType.String,
  options: {},
};

const response: IBaseQueryVo = {
  columns: [
    {
      column: 'Item label',
      name: 'Label',
      type: BaseQueryColumnType.Field,
      fieldSource: textField,
    },
    {
      column: 'Sites',
      name: 'Sites',
      type: BaseQueryColumnType.Field,
      fieldSource: {
        ...textField,
        id: 'fldSites',
        name: 'Sites',
        dbFieldName: 'sites',
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: true,
      },
    },
    {
      column: 'Summary',
      name: 'Summary',
      type: BaseQueryColumnType.Field,
      fieldSource: {
        ...textField,
        id: 'fldSummary',
        name: 'Summary',
        dbFieldName: 'summary',
        type: FieldType.Formula,
        isComputed: true,
        options: { expression: '{fldLabel}' },
      },
    },
    { column: 'Total', name: 'Total', type: BaseQueryColumnType.Aggregation },
  ],
  rows: [
    {
      'Item label': 'Sample item',
      Sites: ['https://example.com/a', 'https://example.com/b'],
      Summary: 'Ready for review',
      Total: 7,
    },
  ],
};

afterEach(cleanup);

describe('ChartTable JSON query results', () => {
  it.each([PluginPosition.Dashboard, PluginPosition.Panel])(
    'renders field values and URL lists from the %s query',
    (positionType) => {
      env.positionType = positionType;
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      const key =
        positionType === PluginPosition.Dashboard
          ? ['dashboard-plugin-query', env.baseId, env.positionId, env.pluginInstallId]
          : ['plugin-panel-plugin-query', env.tableId, env.positionId, env.pluginInstallId];
      // API fieldSource values are JSON metadata, not SDK field instances.
      client.setQueryData(key, JSON.parse(JSON.stringify(response)));

      const { container, unmount } = render(
        <QueryClientProvider client={client}>
          <ChartTable />
        </QueryClientProvider>
      );

      expect(screen.getByRole('cell', { name: 'Sample item' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'Ready for review' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '7' })).toBeInTheDocument();
      expect(container.querySelectorAll('a')).toHaveLength(2);
      expect(screen.getByRole('link', { name: 'https://example.com/a' })).toHaveAttribute(
        'href',
        'https://example.com/a'
      );
      expect(screen.getByRole('link', { name: 'https://example.com/b' })).toHaveAttribute(
        'href',
        'https://example.com/b'
      );
      expect(screen.getByRole('cell', { name: /https:\/\/example.com\/a/ }).textContent).toBe(
        'https://example.com/a, https://example.com/b'
      );
      unmount();
      client.clear();
    }
  );
});
