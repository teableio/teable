import { X } from '@teable/icons';
import type { BaseQueryColumnType, IBaseQueryGroupBy } from '@teable/openapi';
import { Button, Error } from '@teable/ui-lib';
import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { ContextColumnSelector } from '../common/ContextColumnSelector';
import { NewPopover } from '../common/NewPopover';
import { useAllColumns } from '../common/useAllColumns';
import { QueryFormContext } from '../context/QueryFormContext';
import type { IQueryEditorProps } from './types';

export const QueryGroup = (props: IQueryEditorProps<IBaseQueryGroupBy>) => {
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
    registerValidator('groupBy', validator);
    return () => {
      registerValidator('groupBy', undefined);
    };
  }, [registerValidator, validator]);

  return (
    <div className="flex flex-1 flex-col gap-2">
      {value?.map((groupBy, index) => (
        <div key={index}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-3">
              <ContextColumnSelector
                value={groupBy.column}
                onChange={(column) => {
                  const newGroupBy = [...value];
                  newGroupBy[index] = {
                    ...groupBy,
                    column,
                  };
                  onChange(newGroupBy);
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
          <Error error={error[groupBy.column] ? t('baseQuery.error.invalidCol') : undefined} />
        </div>
      ))}
      <div>
        <NewQueryGroup
          onSubmit={(group) => {
            onChange([...(value ?? []), group]);
          }}
        />
      </div>
    </div>
  );
};

const NewQueryGroup = (props: { onSubmit: (groupBy: IBaseQueryGroupBy[number]) => void }) => {
  const { onSubmit } = props;
  const [column, setColumn] = useState<string>();
  const [type, setType] = useState<BaseQueryColumnType>();
  const disabled = !column || !type;

  const onAdd = () => {
    if (disabled) {
      return;
    }
    onSubmit({
      column,
      type,
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
        value={column}
        onChange={(column, type) => {
          setColumn(column);
          setType(type);
        }}
      />
    </NewPopover>
  );
};
