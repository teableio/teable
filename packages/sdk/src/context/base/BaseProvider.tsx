import { useQuery } from '@tanstack/react-query';
import type { IGetBaseVo } from '@teable/openapi';
import { getBaseById, getBasePermission } from '@teable/openapi';
import type { FC, ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { Base } from '../../model';
import { AnchorContext } from '../anchor';
import { BaseContext } from './BaseContext';

interface IBaseProviderProps {
  serverData?: IGetBaseVo;
  children: ReactNode;
  fallback?: React.ReactNode;
}

export const BaseProvider: FC<IBaseProviderProps> = ({ children, serverData, fallback }) => {
  const { baseId } = useContext(AnchorContext);
  const { data: baseData } = useQuery({
    queryKey: ['base', baseId],
    queryFn: ({ queryKey }) =>
      queryKey[1] ? getBaseById(queryKey[1]).then((res) => res.data) : undefined,
  });

  const { data: basePermissionData } = useQuery({
    queryKey: ['basePermission', baseId],
    queryFn: ({ queryKey }) =>
      queryKey[1] ? getBasePermission(queryKey[1]).then((res) => res.data) : undefined,
  });

  const value = useMemo(() => {
    const base = baseData || serverData;
    return {
      base: base ? new Base(base) : undefined,
      permission: basePermissionData,
    };
  }, [serverData, baseData, basePermissionData]);

  if (!value.base) {
    return <>{fallback}</>;
  }

  return <BaseContext.Provider value={value}>{children}</BaseContext.Provider>;
};
