import { useContext, useMemo } from 'react';
import { QueryEditorContext } from '../context/QueryEditorContext';

export const useAllColumns = () => {
  const context = useContext(QueryEditorContext);

  return useMemo(
    () => context.columns.from.concat(context.columns.join),
    [context.columns.from, context.columns.join]
  );
};
