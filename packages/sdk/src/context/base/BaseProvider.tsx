import { useQuery } from '@tanstack/react-query';
import type { BaseSchema } from '@teable-group/openapi';
import type { FC, ReactNode } from 'react';
import { useContext, useMemo } from 'react';
import { BaseApi } from '../../api';
import { Base } from '../../model';
import { AnchorContext } from '../anchor';
import { BaseContext } from './BaseContext';

interface IBaseProviderProps {
  serverData?: BaseSchema.IGetBaseVo;
  children: ReactNode;
}

export const BaseProvider: FC<IBaseProviderProps> = ({ children, serverData }) => {
  const { baseId } = useContext(AnchorContext);
  const { data: baseData, isLoading } = useQuery({
    queryKey: ['base', baseId],
    queryFn: ({ queryKey }) => (queryKey[1] ? BaseApi.getBaseById(queryKey[1]) : undefined),
  });

  const value = useMemo(() => {
    const base = isLoading ? serverData : baseData?.data;
    return { base: base ? new Base(base) : undefined };
  }, [isLoading, baseData, serverData]);

  return <BaseContext.Provider value={value}>{children}</BaseContext.Provider>;
};
