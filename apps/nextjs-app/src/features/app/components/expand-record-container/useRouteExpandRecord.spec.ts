import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouteExpandRecord } from './useRouteExpandRecord';

const router = vi.hoisted(() => ({
  pathname: '/base/[baseId]/[[...slug]]',
  query: {} as Record<string, unknown>,
  push: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));

const raiseRecordPanel = vi.hoisted(() => vi.fn());
vi.mock('@teable/sdk/components/expand-record/raiseRecordPanel', () => ({ raiseRecordPanel }));

describe('useRouteExpandRecord', () => {
  beforeEach(() => {
    router.push.mockClear();
    raiseRecordPanel.mockClear();
  });

  it('brings the open record back on top when it is expanded again', () => {
    router.query = { slug: ['table', 'tblA', 'viwA'], recordId: 'recA' };
    const { result } = renderHook(() => useRouteExpandRecord('tblA'));

    act(() => result.current.setExpandRecordId('recA'));

    expect(raiseRecordPanel).toHaveBeenCalledWith('tblA', 'recA');
    // the url already names it
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens another record through the url and raises it', () => {
    router.query = { slug: ['table', 'tblA', 'viwA'], recordId: 'recA' };
    const { result } = renderHook(() => useRouteExpandRecord('tblA'));

    act(() => result.current.setExpandRecordId('recB'));

    expect(raiseRecordPanel).toHaveBeenCalledWith('tblA', 'recB');
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('raises nothing when it closes the record', () => {
    router.query = { slug: ['table', 'tblA', 'viwA'], recordId: 'recA' };
    const { result } = renderHook(() => useRouteExpandRecord('tblA'));

    act(() => result.current.closeExpandRecord());

    expect(raiseRecordPanel).not.toHaveBeenCalled();
  });
});
