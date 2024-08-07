import { useState } from 'react';
import type { IQueryEditorContext } from './QueryEditorContext';
import { QueryEditorContext } from './QueryEditorContext';

export const QueryEditorProvider = (props: {
  columns: IQueryEditorContext['columns'];
  canSelectedColumnIds?: IQueryEditorContext['canSelectedColumnIds'];
  children: React.ReactNode;
  defaultStatus?: IQueryEditorContext['status'];
}) => {
  const { defaultStatus, children, columns, canSelectedColumnIds } = props;
  const [status, setStatus] = useState<IQueryEditorContext['status']>(
    defaultStatus ?? {
      select: false,
      aggregation: false,
      where: false,
      orderBy: false,
      groupBy: false,
      limit: false,
      offset: false,
      join: false,
    }
  );
  return (
    <QueryEditorContext.Provider
      value={{
        status,
        setStatus: (type, value) => setStatus((prev) => ({ ...prev, [type]: value })),
        columns,
        canSelectedColumnIds,
      }}
    >
      {children}
    </QueryEditorContext.Provider>
  );
};
