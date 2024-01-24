import { ActionPrefix } from '@teable-group/core';
import { renderHook } from '@testing-library/react';
import { createAppContext } from '../context/__tests__/createAppContext';
import { usePermissionActionsStatic } from './use-permission-actions-static';

describe('usePermissionActionsStatic', () => {
  it('filters out excludes', () => {
    const { result } = renderHook(() => usePermissionActionsStatic([ActionPrefix.Space]), {
      wrapper: createAppContext(),
    });
    expect(Object.keys(result.current)).toEqual(
      expect.arrayContaining([
        ActionPrefix.Base,
        ActionPrefix.Table,
        ActionPrefix.View,
        ActionPrefix.Record,
        ActionPrefix.Field,
      ])
    );
  });

  it('returns all actions if excludes is undefined', () => {
    const { result } = renderHook(() => usePermissionActionsStatic(), {
      wrapper: createAppContext(),
    });
    expect(Object.keys(result.current)).toEqual(
      expect.arrayContaining([
        ActionPrefix.Space,
        ActionPrefix.Base,
        ActionPrefix.Table,
        ActionPrefix.View,
        ActionPrefix.Record,
        ActionPrefix.Field,
      ])
    );
  });

  it('action description should be translated', () => {
    const { result } = renderHook(() => usePermissionActionsStatic(), {
      wrapper: createAppContext(),
    });
    expect(result.current[ActionPrefix.Space][0].description).toEqual('Create space');
  });
});
