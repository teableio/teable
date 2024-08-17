import { useQuery } from '@tanstack/react-query';
import type { IFieldRo } from '@teable/core';
import { planField, planFieldCreate, planFieldConvert } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export function usePlan({
  tableId,
  fieldId,
  fieldRo,
}: {
  tableId: string;
  fieldId?: string;
  fieldRo?: IFieldRo;
}) {
  const { data: updatePlan } = useQuery({
    queryKey: ReactQueryKeys.planFieldConvert(tableId, fieldId as string, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) =>
      planFieldConvert(queryKey[1], queryKey[2], queryKey[3]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: !!(fieldId && fieldRo),
  });

  const { data: createPlan } = useQuery({
    queryKey: ReactQueryKeys.planFieldCreate(tableId, fieldRo as IFieldRo),
    queryFn: ({ queryKey }) => planFieldCreate(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: !!(!fieldId && fieldRo),
  });

  const { data: staticPlan } = useQuery({
    queryKey: ReactQueryKeys.planField(tableId, fieldId as string),
    queryFn: ({ queryKey }) => planField(queryKey[1], queryKey[2]).then((data) => data.data),
    refetchOnWindowFocus: false,
    enabled: !!(fieldId && !fieldRo),
  });

  return createPlan || staticPlan || updatePlan;
}
