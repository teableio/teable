import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from '../context/table-permission/TablePermissionContext';
import { useFieldAwareTableListener } from './use-field-aware-table-listener';
import { useTableListener } from './use-table-listener';

vi.mock('./use-table-listener', () => ({
  useTableListener: vi.fn(),
}));

const mockedUseTableListener = vi.mocked(useTableListener);

type IHandler = (actionKey: string, payload?: Record<string, unknown>) => void;

const renderListener = (
  relevantFieldIds: Set<string> | null,
  options?: { recordReadFilter?: unknown }
) => {
  const callback = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TablePermissionContext.Provider
      value={
        {
          ...TablePermissionContextDefaultValue,
          recordReadFilter: options?.recordReadFilter,
        } as never
      }
    >
      {children}
    </TablePermissionContext.Provider>
  );
  renderHook(
    () => useFieldAwareTableListener('tblTest', ['setRecord'], relevantFieldIds, callback),
    { wrapper }
  );
  const handler = mockedUseTableListener.mock.calls.at(-1)?.[2] as IHandler;
  return { callback, handler };
};

describe('useFieldAwareTableListener', () => {
  beforeEach(() => {
    mockedUseTableListener.mockReset();
  });

  it('skips setRecord with an explicit empty fieldIds payload (row reorder)', () => {
    const { callback, handler } = renderListener(new Set(['fldA']));
    handler('setRecord', { fieldIds: [] });
    expect(callback).not.toHaveBeenCalled();
  });

  it('skips setRecord whose fieldIds do not overlap the relevant fields', () => {
    const { callback, handler } = renderListener(new Set(['fldA']));
    handler('setRecord', { fieldIds: ['fldB'] });
    expect(callback).not.toHaveBeenCalled();
  });

  it('refreshes when a changed field is relevant', () => {
    const { callback, handler } = renderListener(new Set(['fldA']));
    handler('setRecord', { fieldIds: ['fldA', 'fldB'] });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('refreshes conservatively when the payload has no fieldIds', () => {
    const { callback, handler } = renderListener(new Set(['fldA']));
    handler('setRecord', undefined);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('refreshes for non-setRecord actions regardless of fieldIds', () => {
    const { callback, handler } = renderListener(new Set(['fldA']));
    handler('addRecord', { fieldIds: [] });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('refreshes everything when the relevant scope is unbounded (null)', () => {
    const { callback, handler } = renderListener(null);
    handler('setRecord', { fieldIds: ['fldB'] });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('treats record read filter fields as relevant', () => {
    const { callback, handler } = renderListener(new Set(['fldA']), {
      recordReadFilter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fldAuthority', operator: 'is', value: 'me' }],
      },
    });
    handler('setRecord', { fieldIds: ['fldAuthority'] });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
