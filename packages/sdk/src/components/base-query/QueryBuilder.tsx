import { X } from '@teable/icons';
import { BaseQueryColumnType, baseQuerySchema, getFields } from '@teable/openapi';
import type {
  IBaseQueryColumn,
  IBaseQuery,
  IBaseQueryJoin,
  IQueryAggregation,
} from '@teable/openapi';
import { Badge, Button } from '@teable/ui-lib';
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useTables } from '../../hooks';
import { QuerySortedKeys } from './constant';
import type { IContextColumns } from './context/QueryEditorContext';
import { QueryEditorProvider } from './context/QueryEditorProvider';
import { QueryFormContext } from './context/QueryFormContext';
import { QueryFormProvider } from './context/QueryFormProvider';
import { FormItem } from './FormItem';
import { QueryEditorContainer } from './QueryEditorContainer';
import { QueryFrom } from './QueryFom';
import { QueryOperators } from './QueryOperators';

export interface IBaseQueryBuilderRef {
  validateQuery: () => boolean;
}

export const BaseQueryBuilder = forwardRef<
  IBaseQueryBuilderRef,
  {
    className?: string;
    query?: IBaseQuery;
    onChange: (query?: IBaseQuery) => void;
  }
>((props, ref) => {
  return (
    <QueryFormProvider>
      <QueryBuilderContainer {...props} ref={ref} />
    </QueryFormProvider>
  );
});

BaseQueryBuilder.displayName = 'QueryBuilder';

const QueryBuilderContainer = forwardRef<
  IBaseQueryBuilderRef,
  {
    className?: string;
    query?: IBaseQuery;
    onChange: (query?: IBaseQuery) => void;
    getContextFromChild?: (context: IBaseQueryColumn[]) => void;
    depth?: number;
  }
>((props, ref) => {
  const { query, onChange, depth = 0, getContextFromChild } = props;
  const { t } = useTranslation();
  const [fromType, setFromType] = useState<'table' | 'query'>();
  const [childContext, setChildContext] = useState<IBaseQueryColumn[]>([]);
  const [joinContext, setJoinContext] = useState<IContextColumns>([]);
  const [aggregationContext, setAggregationContext] = useState<IBaseQueryColumn[]>([]);
  const tables = useTables();
  const formQueryRef = useRef<IBaseQueryBuilderRef>(null);
  const { validators } = useContext(QueryFormContext);

  useImperativeHandle(ref, () => ({
    validateQuery: () => {
      // validate from
      // zod
      if (
        !query?.from ||
        (typeof query.from === 'string' && !tables.some((table) => table.id === query.from)) ||
        (typeof query.from !== 'string' && !baseQuerySchema.safeParse(query.from).success)
      ) {
        return false;
      }
      // context validators
      if (formQueryRef.current && !formQueryRef.current.validateQuery()) {
        return false;
      }
      // validate all keys
      if (QuerySortedKeys.some((key) => validators[key] && !validators[key]?.())) return false;

      return true;
    },
  }));

  useEffect(() => {
    const aggregationColumns = aggregationContext.map((aggregation) => ({
      column: aggregation.column,
      type: BaseQueryColumnType.Aggregation,
      name: aggregation.name,
    }));
    const allColumns = [...childContext, ...aggregationColumns, ...joinContext];
    if (!query?.select) {
      return getContextFromChild?.(allColumns);
    }
    const selectCols = query?.select;
    getContextFromChild?.(
      aggregationColumns.concat(
        selectCols
          .map((selectCol) => allColumns.find((v) => v.column === selectCol.column))
          .filter(Boolean) as IBaseQueryColumn[]
      )
    );
  }, [aggregationContext, childContext, getContextFromChild, joinContext, query?.select]);

  const onFormChange = async (type: string, tableId?: string) => {
    if (type === 'table' && tableId) {
      setFromType('table');
      const context = await getContextWithTableIds([tableId]);
      setChildContext(context);
      return onChange({ ...query, from: tableId });
    }
    setFromType('query');
  };

  const clearFrom = () => {
    setFromType(undefined);
    onChange({ from: '' });
  };

  const getContextWithTableIds = async (tableIds: string[]) => {
    const fields = await Promise.all(
      tableIds.map((tableId) =>
        getFields(tableId).then((res) => res.data.map((v) => ({ ...v, tableId })))
      )
    );
    return fields.flat().map(
      (field) =>
        ({
          column: field.id,
          type: BaseQueryColumnType.Field,
          name: field.name,
          fieldSource: field,
          tableId: field.tableId,
        }) as IBaseQueryColumn & { tableId: string }
    );
  };

  const onSourceChange = async (source?: IBaseQuery) => {
    if (!source) {
      return clearFrom();
    }
    onChange({ ...query, from: source ?? '' });
  };

  const onQueryChange = async <T extends keyof IBaseQuery>(key: T, value: IBaseQuery[T]) => {
    if (!query) return;
    // collect context
    if (key === 'join' && value) {
      const join = value as IBaseQueryJoin[];
      const context = await getContextWithTableIds(
        join.map((v) => v.table).filter((v) => !!v) as string[]
      );
      setJoinContext(
        context.map((v) => ({
          ...v,
          group: {
            id: v.tableId,
            name: tables.find((table) => table.id === v.tableId)?.name ?? v.tableId,
          },
        }))
      );
    }
    if (key === 'aggregation' && value) {
      const aggregations = value as IQueryAggregation;
      setAggregationContext(
        aggregations
          .map((aggregation) => {
            const column = [...joinContext, ...childContext].find(
              (v) => v.column === aggregation.column
            );
            if (!column) return;
            return {
              name: `${column.name}_${aggregation.statisticFunc}`,
              type: column.type,
              column: `${aggregation.column}_${aggregation.statisticFunc}`,
              fieldSource: column.fieldSource,
            };
          })
          .filter(Boolean) as IBaseQueryColumn[]
      );
    }
    console.log(depth, 'onQueryChange', key, value);
    onChange({ ...query, [key]: value });
  };

  const handleGetContextFromChild = useCallback((childContext: IBaseQueryColumn[]) => {
    setChildContext(childContext);
  }, []);

  const validatedFrom = useMemo(
    () =>
      query?.from &&
      (typeof query.from === 'string'
        ? tables.some((table) => table.id === query.from)
        : baseQuerySchema.safeParse(query.from).success),
    [query?.from, tables]
  );

  const providerContextColumns = useMemo(() => {
    return {
      from: childContext,
      join: joinContext,
    };
  }, [childContext, joinContext]);

  return (
    <div className="relative rounded border p-4 px-2">
      {depth > 0 && (
        <Button
          className="absolute right-1 top-1 h-auto rounded-full p-0.5 text-[13px]"
          size={'xs'}
          variant={'outline'}
          onClick={() => onChange(undefined)}
        >
          <X />
        </Button>
      )}
      <div className="mb-4 flex gap-5 text-sm">
        <FormItem label={t('baseQuery.from.title')}>
          <div className="group relative min-h-7 flex-1">
            {!query?.from && !fromType && <QueryFrom onClick={onFormChange} />}
            {query?.from && fromType === 'table' && (
              <Badge variant={'outline'} className="mt-0.5 h-6 gap-1">
                {tables.find((table) => table.id === query.from)?.name}
                <X className="cursor-pointer" onClick={clearFrom} />
              </Badge>
            )}
            {fromType === 'query' && (
              <QueryFormProvider>
                <QueryBuilderContainer
                  ref={formQueryRef}
                  query={query?.from as IBaseQuery}
                  onChange={onSourceChange}
                  depth={depth + 1}
                  getContextFromChild={handleGetContextFromChild}
                />
              </QueryFormProvider>
            )}
          </div>
        </FormItem>
      </div>
      {validatedFrom && (
        <QueryEditorProvider
          columns={providerContextColumns}
          defaultStatus={{
            join: !!query?.join,
            limit: !!query?.limit,
            where: !!query?.where,
            offset: !!query?.offset,
            select: !!query?.select,
            groupBy: !!query?.groupBy,
            orderBy: !!query?.orderBy,
            aggregation: !!query?.aggregation,
          }}
        >
          <QueryOperators />
          <QueryEditorContainer query={query!} onChange={onQueryChange} />
        </QueryEditorProvider>
      )}
    </div>
  );
});

QueryBuilderContainer.displayName = 'QueryBuilderContainer';
