import { useMutation } from '@tanstack/react-query';
import { baseQuery, type IBaseQuery } from '@teable/openapi';
import type { IBaseQueryBuilderRef } from '@teable/sdk/components';
import { BaseQueryBuilder } from '@teable/sdk/components';
import { useBaseId } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib';
import { useRef, useState } from 'react';
import { ChartDisplay } from './ChartDisplay';

export const ChartPage = () => {
  const [query, setQuery] = useState<IBaseQuery>();
  const baseId = useBaseId();
  const queryBuilderRef = useRef<IBaseQueryBuilderRef>(null);

  const { mutate: baseQueryMutate, data } = useMutation({
    mutationFn: ({ baseId, query }: { baseId: string; query: IBaseQuery }) =>
      baseQuery(baseId, query),
  });

  return (
    <div className="flex size-full flex-col overflow-auto">
      <h1 className="p-2 text-center">Chart Page</h1>
      <div className="m-10">
        <BaseQueryBuilder ref={queryBuilderRef} query={query} onChange={setQuery} />
      </div>
      <Button
        className="mx-10 shrink-0"
        size={'sm'}
        onClick={() => {
          if (queryBuilderRef.current?.validateQuery() && query && baseId) {
            baseQueryMutate({ baseId, query });
          }
        }}
      >
        To Query
      </Button>
      {data?.data && <ChartDisplay data={data?.data} />}
    </div>
  );
};
