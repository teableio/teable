import { useState } from 'react';
import type { IQueryEditorContext } from './QueryEditorContext';
import { QueryEditorContext } from './QueryEditorContext';

export const QueryEditorProvider = (props: {
  columns: IQueryEditorContext['columns'];
  children: React.ReactNode;
  defaultStatus?: IQueryEditorContext['status'];
}) => {
  const { defaultStatus, children, columns } = props;
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
      }}
    >
      {children}
    </QueryEditorContext.Provider>
  );
};
