import { useQuery } from '@tanstack/react-query';
import {
  getBaseById,
  getBasePermission,
  LastVisitResourceType,
  updateUserLastVisit,
} from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { Base } from '../../model';
import { AnchorContext } from '../anchor';
import { BaseContext } from './BaseContext';
interface IBaseProviderProps {
  children: ReactNode;
  fallback?: React.ReactNode;
}

export const BaseProvider: FC<IBaseProviderProps> = ({ children, fallback }) => {
  const { baseId } = useContext(AnchorContext);
  const { data: baseData } = useQuery({
    queryKey: ReactQueryKeys.base(baseId as string),
    queryFn: ({ queryKey }) =>
      queryKey[1] ? getBaseById(queryKey[1]).then((res) => res.data) : undefined,
  });

  useEffect(() => {
    if (baseData) {
      updateUserLastVisit({
        resourceId: baseData.id,
        resourceType: LastVisitResourceType.Base,
        parentResourceId: baseData.spaceId,
      });
    }
  }, [baseData]);

  const { data: basePermissionData } = useQuery({
    queryKey: ReactQueryKeys.getBasePermission(baseId as string),
    queryFn: ({ queryKey }) =>
      queryKey[1] ? getBasePermission(queryKey[1]).then((res) => res.data) : undefined,
  });

  const value = useMemo(() => {
    const base = baseData;
    return {
      base: base ? new Base(base) : undefined,
      permission: basePermissionData,
    };
  }, [baseData, basePermissionData]);

  if (!value.base) {
    return <>{fallback}</>;
  }

  return <BaseContext.Provider value={value}>{children}</BaseContext.Provider>;
};
