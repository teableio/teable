import { SortFunc } from '@teable/core';
import { X } from '@teable/icons';
import type { BaseQueryColumnType, IBaseQueryOrderBy } from '@teable/openapi';
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Error,
} from '@teable/ui-lib';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { ContextColumnSelector } from '../common/ContextColumnSelector';
import { NewPopover } from '../common/NewPopover';
import { useAllColumns } from '../common/useAllColumns';
import { QueryFormContext } from '../context/QueryFormContext';
import type { IQueryEditorProps } from './types';

export const QueryOrder = (props: IQueryEditorProps<IBaseQueryOrderBy>) => {
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
    registerValidator('orderBy', validator);
    return () => {
      registerValidator('orderBy', undefined);
    };
  }, [registerValidator, validator]);

  return (
    <div className="flex flex-1 flex-col gap-2">
      {value?.map((orderBy, index) => (
        <div key={index}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3">
              <ContextColumnSelector
                isFilter
                className="flex-1"
                value={orderBy.column}
                onChange={(column) => {
                  const newOrderBy = [...value];
                  newOrderBy[index] = {
                    ...orderBy,
                    column,
                  };
                  onChange(newOrderBy);
                }}
              />
              <Separator className="w-2" />
              <SortFuncSelector
                value={orderBy.order}
                onChange={(order) => {
                  const newOrderBy = [...value];
                  newOrderBy[index] = {
                    ...orderBy,
                    order,
                  };
                  onChange(newOrderBy);
                }}
              />
            </div>
            <Button
              className="h-7"
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
          <Error error={error[orderBy.column] ? t('baseQuery.error.invalidCol') : undefined} />
        </div>
      ))}
      <div>
        <NewQueryOrder
          onSubmit={(order) => {
            onChange([...(value ?? []), order]);
          }}
        />
      </div>
    </div>
  );
};

const NewQueryOrder = (props: { onSubmit: (orderBy: IBaseQueryOrderBy[number]) => void }) => {
  const { onSubmit } = props;
  const [column, setColumn] = useState<string>();
  const [type, setType] = useState<BaseQueryColumnType>();
  const [order, setOrder] = useState<SortFunc>(SortFunc.Asc);
  const disabled = !column || !type;

  const onAdd = () => {
    if (disabled) {
      return;
    }
    onSubmit({
      column,
      type,
      order,
    });
    setColumn(undefined);
    setType(undefined);
  };

  return (
    <NewPopover
      addButton={{
        disabled,
      }}
      onSubmit={onAdd}
    >
      <ContextColumnSelector
        className="flex-1"
        value={column}
        isFilter
        onChange={(column, type) => {
          setColumn(column);
          setType(type);
        }}
      />
      <Separator className="w-2" />
      <SortFuncSelector value={order} onChange={setOrder} />
    </NewPopover>
  );
};

const SortFuncSelector = (props: { value?: SortFunc; onChange: (value: SortFunc) => void }) => {
  const { value, onChange } = props;
  const { t } = useTranslation();
  const options = useMemo(() => {
    return [
      { value: SortFunc.Asc, label: t('baseQuery.orderBy.asc') },
      { value: SortFunc.Desc, label: t('baseQuery.orderBy.desc') },
    ];
  }, [t]);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 flex-1 py-0 text-[13px]">
        <SelectValue placeholder={t('common.selectPlaceHolder')} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem value={option.value} key={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
