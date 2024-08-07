import type { StatisticsFunc } from '@teable/core';
import { CellValueType, FieldType, getValidStatisticFunc } from '@teable/core';
import { X } from '@teable/icons';
import { BaseQueryColumnType } from '@teable/openapi';
import type { IQueryAggregation } from '@teable/openapi';
import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Error,
} from '@teable/ui-lib';
import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useStatisticFunc2NameMap } from '../../grid-enhancements';
import { ContextColumnSelector } from '../common/ContextColumnSelector';
import { NewPopover } from '../common/NewPopover';
import { useAllColumns } from '../common/useAllColumns';
import { QueryEditorContext } from '../context/QueryEditorContext';
import { QueryFormContext } from '../context/QueryFormContext';
import type { IQueryEditorProps } from './types';

export const QueryAggregation = (props: IQueryEditorProps<IQueryAggregation>) => {
  const { value, onChange } = props;

  const { registerValidator } = useContext(QueryFormContext);
  const [error, setError] = useState<Record<string, boolean>>({});
  const columns = useAllColumns();
  const { t } = useTranslation();

  const validator = useCallback(() => {
    setError({});
    if (!value) {
      return true;
    }
    const columnsIds = columns.map((c) => c.column);
    const excludeValue = value.filter((v) => !columnsIds.includes(v.column));
    if (excludeValue.length) {
      setError(excludeValue.reduce((acc, v) => ({ ...acc, [v.column]: true }), {}));
    }
    return excludeValue.length === 0;
  }, [columns, value, setError]);

  useEffect(() => {
    registerValidator('aggregation', validator);
    return () => {
      registerValidator('aggregation', undefined);
    };
  }, [registerValidator, validator]);

  return (
    <div className="flex flex-1 flex-col gap-2">
      {value?.map((aggregation, index) => (
        <div key={index}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3">
              <ContextColumnSelector
                value={aggregation.column}
                onChange={(column, type) => {
                  const newAggregation = [...value];
                  newAggregation[index] = {
                    ...aggregation,
                    type,
                    column,
                  };
                  onChange(newAggregation);
                }}
              />
              <Separator className="w-2" />
              <AggregationStaticSelector
                value={aggregation.statisticFunc}
                columnId={aggregation.column}
                onChange={(statisticFunc) => {
                  const newAggregation = [...value];
                  newAggregation[index] = {
                    ...aggregation,
                    statisticFunc,
                  };
                  onChange(newAggregation);
                }}
              />
            </div>
            <Button
              className="h-7 text-[13px]"
              variant={'link'}
              onClick={() => {
                const newValue = [...value];
                newValue.splice(index, 1);
                onChange(newValue);
              }}
            >
              <X />
            </Button>
          </div>
          <Error error={error[aggregation.column] ? t('baseQuery.error.invalidCol') : undefined} />
        </div>
      ))}
      <div>
        <NewAggregation onSubmit={(col) => onChange([...(value ?? []), col])} />
      </div>
    </div>
  );
};

const NewAggregation = (props: { onSubmit: (value: IQueryAggregation[number]) => void }) => {
  const { onSubmit } = props;
  const [column, setColumn] = useState<string>();
  const [statisticFunc, setStatisticFunc] = useState<StatisticsFunc>();
  const [type, setType] = useState<BaseQueryColumnType>();

  const onAdd = () => {
    if (column && statisticFunc && type) {
      onSubmit({ column, statisticFunc, type });
      setColumn(undefined);
      setStatisticFunc(undefined);
      setType(undefined);
    }
  };
  return (
    <NewPopover
      addButton={{
        disabled: !column || !statisticFunc || !type,
      }}
      onSubmit={onAdd}
    >
      <ContextColumnSelector
        className="flex-1"
        value={column}
        onChange={(column, type) => {
          setType(type);
          setColumn(column);
        }}
      />
      <Separator className="w-2" />
      <AggregationStaticSelector
        className="flex-1"
        value={statisticFunc}
        columnId={column}
        onChange={(statisticFunc) => {
          setStatisticFunc(statisticFunc);
        }}
      />
    </NewPopover>
  );
};

const AggregationStaticSelector = (props: {
  className?: string;
  value?: StatisticsFunc;
  columnId?: string;
  onChange: (value: StatisticsFunc) => void;
}) => {
  const { className, value, columnId, onChange } = props;
  const statisticFunc2NameMap = useStatisticFunc2NameMap();
  const { columns } = useContext(QueryEditorContext);
  const { t } = useTranslation();
  const column = columnId
    ? [...columns.from, ...columns.join].find((c) => c.column === columnId)
    : undefined;

  const menuItems = column
    ? getValidStatisticFunc(
        column.type === BaseQueryColumnType.Field
          ? column.fieldSource
          : {
              type: FieldType.Number,
              cellValueType: CellValueType.Number,
            }
      )
    : [];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        disabled={!column}
        className={cn('h-7 w-auto min-w-20 text-[13px]', className)}
      >
        <SelectValue placeholder={t('common.selectPlaceHolder')} />
      </SelectTrigger>
      <SelectContent>
        {menuItems.map((type) => (
          <SelectItem key={type} value={type}>
            {statisticFunc2NameMap[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
