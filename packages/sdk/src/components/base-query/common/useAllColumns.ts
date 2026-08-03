import { useContext, useMemo } from 'react';
import { QueryEditorContext } from '../context/QueryEditorContext';

export const useAllColumns = (isFilter?: boolean) => {
  const context = useContext(QueryEditorContext);

  return useMemo(() => {
    const columns = context.columns.from.concat(context.columns.join);
    if (isFilter) {
      return columns.filter(
        (column) =>
          context.canSelectedColumnIds === undefined ||
          context.canSelectedColumnIds.includes(column.column)
      );
    }
    return columns;
  }, [context.columns.from, context.columns.join, context.canSelectedColumnIds, isFilter]);
};
