import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../context/app/AppContext';
import type { IAppContext } from '../context/app/AppContext';
import { usePresenceConnection } from './use-presence-connection';

const connection = { id: 'conn' };
vi.mock('./use-connection', () => ({ useConnection: () => ({ connection }) }));

const withApp =
  (value: Partial<IAppContext>) =>
  // eslint-disable-next-line react/display-name
  ({ children }: { children: ReactNode }) => (
    <AppContext.Provider value={value as IAppContext}>{children}</AppContext.Provider>
  );

describe('usePresenceConnection', () => {
  it('hands out the connection in the app and on share links', () => {
    expect(renderHook(() => usePresenceConnection(), { wrapper: withApp({}) }).result.current).toBe(
      connection
    );
    expect(
      renderHook(() => usePresenceConnection(), { wrapper: withApp({ shareId: 'shrX' }) }).result
        .current
    ).toBe(connection);
  });

  it('hands out none in a template preview', () => {
    const { result } = renderHook(() => usePresenceConnection(), {
      wrapper: withApp({ template: { id: 'tplX', headers: 'signed' } }),
    });
    expect(result.current).toBeUndefined();
  });

  it('hands out the connection outside any app context', () => {
    expect(renderHook(() => usePresenceConnection()).result.current).toBe(connection);
  });
});
