import { useQuery } from '@tanstack/react-query';
import { getSharedBase } from '@teable/openapi';
import { BaseCard } from './BaseCard';

export const SharedBasePage = () => {
  const { data: bases } = useQuery({
    queryKey: ['shared-base-list'],
    queryFn: () => getSharedBase().then((res) => res.data),
  });

  return (
    <div className="flex-1 p-10">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        {bases?.map((base) => (
          <div key={base.id}>
            <BaseCard className="h-24 min-w-[17rem] max-w-[34rem] flex-1" base={base} />
          </div>
        ))}
      </div>
    </div>
  );
};
