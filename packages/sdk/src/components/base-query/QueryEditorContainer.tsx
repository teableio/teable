import type { IBaseQuery } from '@teable/openapi';
import { useContext, useMemo } from 'react';
import { QuerySortedKeysMap } from './constant';
import type { QueryEditorKey } from './context/QueryEditorContext';
import { QueryEditorContext } from './context/QueryEditorContext';
import { FormItem } from './FormItem';
import { QueryEditor } from './QueryEditor';
import { useQueryOperatorsStatic } from './useQueryOperatorsStatic';

export const QueryEditorContainer = ({
  query,
  onChange,
}: {
  query: IBaseQuery;
  onChange: <T extends keyof IBaseQuery>(key: T, value: IBaseQuery[T]) => void;
}) => {
  const { status } = useContext(QueryEditorContext);
  const queryOperatorsStatic = useQueryOperatorsStatic();

  const queryOperatorsStaticMap = useMemo(
    () =>
      queryOperatorsStatic.reduce(
        (acc, cur) => {
          acc[cur.key] = cur.label;
          return acc;
        },
        {} as Record<string, string>
      ),
    [queryOperatorsStatic]
  );

  return (
    <div className="mt-4 flex flex-col gap-4">
      {Object.keys(status)
        .sort((a, b) => QuerySortedKeysMap[a] - QuerySortedKeysMap[b])
        .map((key) => {
          if (status[key as keyof typeof status]) {
            return (
              <FormItem key={key} label={queryOperatorsStaticMap[key]}>
                <QueryEditor query={query} onChange={onChange} type={key as QueryEditorKey} />
              </FormItem>
            );
          }
          return null;
        })}
    </div>
  );
};
