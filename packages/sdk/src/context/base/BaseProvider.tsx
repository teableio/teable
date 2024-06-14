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
}

export const BaseProvider: FC<IBaseProviderProps> = ({ children, serverData }) => {
  const { baseId } = useContext(AnchorContext);
  const { data: baseData, isLoading } = useQuery({
    queryKey: ['base', baseId],
    queryFn: ({ queryKey }) => (queryKey[1] ? getBaseById(queryKey[1]) : undefined),
  });

  const { data: basePermissionData } = useQuery({
    queryKey: ['basePermission', baseId],
    queryFn: ({ queryKey }) => (queryKey[1] ? getBasePermission(queryKey[1]) : undefined),
  });

  const value = useMemo(() => {
    const base = isLoading ? serverData : baseData?.data;
    return {
      base: base ? new Base(base) : undefined,
      permission: basePermissionData?.data,
    };
  }, [isLoading, serverData, baseData?.data, basePermissionData?.data]);

  return <BaseContext.Provider value={value}>{children}</BaseContext.Provider>;
};
