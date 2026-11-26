import { PublicFileAvailability } from '@teable/openapi';
import { PUBLIC_ATTACHMENT_ICON, PUBLIC_ATTACHMENT_OFF_ICON } from '@teable/sdk/components';
import { useMemo } from 'react';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';

/**
 * Public attachment fields show in amber while their space's links do not open: out of credits,
 * or the plan lapsed. The availability comes with the base usage the grid reads anyway.
 */
export const usePublicFileColumns = <T extends { icon?: string }>(columns: T[]): T[] => {
  const availability = useBaseUsage()?.publicFileAvailability;
  const linksOff = availability !== undefined && availability !== PublicFileAvailability.Live;

  return useMemo(() => {
    if (!linksOff) return columns;
    return columns.map((column) =>
      column.icon === PUBLIC_ATTACHMENT_ICON
        ? { ...column, icon: PUBLIC_ATTACHMENT_OFF_ICON }
        : column
    );
  }, [linksOff, columns]);
};
