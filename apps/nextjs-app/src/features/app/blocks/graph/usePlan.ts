import { useQuery } from '@tanstack/react-query';
import type { IFieldRo } from '@teable/core';
import { planField, planFieldCreate, planFieldConvert } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useEffect } from 'react';

export function usePlan({
  tableId,
  fieldId,
  fieldRo,
}: {
  tableId: string;
  fieldId?: string;
  fieldRo?: IFieldRo;
}) {
  const { data: updatePlan, refetch: planUpdate } = useQuery({
    queryKey: ReactQueryKeys.planFieldConvert(tableId, fieldId as string, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) =>
      planFieldConvert(queryKey[1], queryKey[2], queryKey[3]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const { data: createPlan, refetch: planCreate } = useQuery({
    queryKey: ReactQueryKeys.planFieldCreate(tableId, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) => planFieldCreate(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const { data: staticPlan, refetch: planStatic } = useQuery({
    queryKey: ReactQueryKeys.planField(tableId, fieldId as string),
    queryFn: ({ queryKey }) => planField(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const isUpdate = fieldId && fieldRo;
  const isStatic = fieldId && !fieldRo;
  const isCreate = !fieldId && fieldRo;

  useEffect(() => {
    if (isUpdate) {
      planUpdate();
    }

    if (isCreate) {
      planCreate();
    }

    if (isStatic) {
      planStatic();
    }
  }, [isCreate, isStatic, isUpdate, planCreate, planStatic, planUpdate]);

  return createPlan || staticPlan || updatePlan;
}
