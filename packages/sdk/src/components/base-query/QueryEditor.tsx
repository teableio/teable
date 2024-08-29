import type { IBaseQuery } from '@teable/openapi';
import { Input } from '@teable/ui-lib';
import type { QueryEditorKey } from './context/QueryEditorContext';
import { QueryAggregation } from './editors/QueryAggregation';
import { QueryFilter } from './editors/QueryFilter/QueryFilter';
import { QueryGroup } from './editors/QueryGroup';
import { QueryJoin } from './editors/QueryJoin';
import { QueryOrder } from './editors/QueryOrder';
import { QuerySelect } from './editors/QuerySelect';

export const QueryEditor = ({
  type,
  query,
  onChange,
}: {
  type: QueryEditorKey;
  query: IBaseQuery;
  onChange: <T extends keyof IBaseQuery>(key: T, value: IBaseQuery[T]) => void;
}) => {
  switch (type) {
    case 'select': {
      return (
        <QuerySelect
          value={query.select}
          onChange={(select) => {
            onChange('select', select);
          }}
        />
      );
    }
    case 'join': {
      return (
        <QueryJoin
          value={query.join}
          onChange={(join) => {
            onChange('join', join);
          }}
        />
      );
    }
    case 'aggregation': {
      return (
        <QueryAggregation
          value={query.aggregation}
          onChange={(aggregation) => onChange('aggregation', aggregation)}
        />
      );
    }
    case 'groupBy': {
      return (
        <QueryGroup value={query.groupBy} onChange={(groupBy) => onChange('groupBy', groupBy)} />
      );
    }
    case 'offset':
    case 'limit': {
      return (
        <Input
          className="h-7 w-16 text-[13px]"
          type="number"
          value={query[type]}
          onChange={(e) => onChange(type, Number(e.target.value))}
        />
      );
    }
    case 'orderBy': {
      return (
        <QueryOrder
          value={query.orderBy}
          onChange={(orderBy) => {
            onChange('orderBy', orderBy);
          }}
        />
      );
    }
    case 'where': {
      return <QueryFilter value={query.where} onChange={(where) => onChange('where', where)} />;
    }
    default:
      return null;
  }
};
