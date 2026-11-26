import { PublicFileAvailability } from '@teable/openapi';
import { PUBLIC_ATTACHMENT_ICON, PUBLIC_ATTACHMENT_OFF_ICON } from '@teable/sdk/components';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { usePublicFileColumns } from './usePublicFileColumns';

vi.mock('@/features/app/hooks/useBaseUsage', () => ({ useBaseUsage: vi.fn() }));

const usage = (publicFileAvailability?: PublicFileAvailability) =>
  ({ publicFileAvailability }) as never;

describe('usePublicFileColumns', () => {
  const columns = [
    { id: 'fldPublic', icon: PUBLIC_ATTACHMENT_ICON },
    { id: 'fldText', icon: 'singleLineText' },
  ];

  beforeEach(() => vi.mocked(useBaseUsage).mockReset());

  it('marks the public attachment fields while the space is paused or its plan lapsed', () => {
    for (const value of [
      usage(PublicFileAvailability.Paused),
      usage(PublicFileAvailability.PlanLapsed),
    ]) {
      vi.mocked(useBaseUsage).mockReturnValue(value);
      const { result } = renderHook(() => usePublicFileColumns(columns));
      expect(result.current[0].icon).toBe(PUBLIC_ATTACHMENT_OFF_ICON);
      expect(result.current[1]).toBe(columns[1]);
    }
  });

  it('keeps the columns while the links work, or before the availability is known', () => {
    for (const value of [usage(PublicFileAvailability.Live), usage(), undefined]) {
      vi.mocked(useBaseUsage).mockReturnValue(value);
      const { result } = renderHook(() => usePublicFileColumns(columns));
      expect(result.current).toBe(columns);
    }
  });
});
