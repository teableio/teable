import { useQuery } from '@tanstack/react-query';
import { X } from '@teable/icons';
import type { IBaseQueryJoin } from '@teable/openapi';
import { BaseQueryJoinType, getFields } from '@teable/openapi';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  Selector,
} from '@teable/ui-lib';
import { useContext, useMemo, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useTables } from '../../../hooks';
import { NewPopover } from '../common/NewPopover';
import { QueryEditorContext } from '../context/QueryEditorContext';
import type { IQueryEditorProps } from './types';

export const QueryJoin = (props: IQueryEditorProps<IBaseQueryJoin[]>) => {
  const { value, onChange } = props;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-hidden">
      {value?.map((join, index) => (
        <div key={index} className="flex items-center gap-2 overflow-auto">
          <QueryJoinItem
            value={join}
            onChange={(newValue) => {
              const newValueList = [...value];
              newValueList[index] = newValue as IBaseQueryJoin;
              onChange(newValueList);
            }}
          />
          <Button
            className="text-[13px]"
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
      ))}
      <div>
        <NewQueryJoin
          onSubmit={(newJoin) => {
            onChange([...(value ?? []), newJoin]);
          }}
        />
      </div>
    </div>
  );
};

const NewQueryJoin = (props: { onSubmit: (value: IBaseQueryJoin) => void }) => {
  const { onSubmit } = props;
  const [type, setType] = useState<BaseQueryJoinType>(BaseQueryJoinType.Left);
  const [table, setTable] = useState<string>();
  const [on, setOn] = useState<string[]>();
  const disabled = !table || !on || !on[0] || !on[1] || !type;
  const onAdd = () => {
    if (disabled) {
      return;
    }
    onSubmit({
      type,
      table,
      on,
    });
    setType(BaseQueryJoinType.Left);
    setTable(undefined);
    setOn(undefined);
  };
  return (
    <NewPopover
      className="w-auto max-w-[100vw]"
      addButton={{
        disabled,
      }}
      onSubmit={onAdd}
    >
      <div className="overflow-y-auto">
        <QueryJoinItem
          className="min-w-[700px]"
          value={{
            type,
            table,
            on,
          }}
          onChange={(value) => {
            setType(value.type ?? BaseQueryJoinType.Left);
            setTable(value.table);
            setOn(value.on);
          }}
        />
      </div>
    </NewPopover>
  );
};

const QueryJoinItem = (props: {
  className?: string;
  value: Partial<IBaseQueryJoin>;
  onChange: (value: Partial<IBaseQueryJoin>) => void;
}) => {
  const { className, value = {}, onChange } = props;
  const context = useContext(QueryEditorContext);
  const columns = context.columns.from;
  const { t } = useTranslation();

  const { data: joinFields } = useQuery({
    queryKey: ['columns', value.table],
    queryFn: ({ queryKey }) => getFields(queryKey[1]!).then((res) => res.data),
    enabled: !!value.table,
  });

  const tables = useTables();
  return (
    <div className={cn('flex flex-1 items-center gap-4', className)}>
      <div className="flex flex-1 items-center gap-4 rounded border bg-accent p-2">
        <Button className="flex-1 text-[13px]" size={'xs'} variant={'outline'}>
          {t('baseQuery.join.data')}
        </Button>
        <JoinTypeSelector
          value={value.type}
          onChange={(type) => onChange({ ...value, type: type as BaseQueryJoinType })}
        />
        <Selector
          placeholder={t('common.selectPlaceHolder')}
          searchTip={t('common.search.placeholder')}
          className="h-auto min-w-28 flex-1 gap-1 p-1 text-[13px]"
          candidates={tables.map((table) => ({ id: table.id, name: table.name, icon: table.icon }))}
          selectedId={value.table}
          onChange={(tableId) => onChange({ ...value, table: tableId })}
        />
      </div>
      <Separator className="w-3" />
      <div className="flex min-h-11 flex-1 items-center gap-4 rounded border bg-accent p-2">
        <Selector
          className="h-auto min-w-12 flex-1 gap-1 p-1 text-[13px]"
          placeholder={t('common.selectPlaceHolder')}
          searchTip={t('common.search.placeholder')}
          candidates={columns?.map((column) => ({ id: column.column, name: column.name }))}
          selectedId={value?.on?.[0]}
          onChange={(columnId) => onChange({ ...value, on: [columnId, value?.on?.[1] ?? ''] })}
        />
        <Badge className="text-xs">=</Badge>
        <Selector
          className="h-auto min-w-12 flex-1 gap-1 p-1 text-[13px]"
          placeholder={t('common.selectPlaceHolder')}
          searchTip={t('common.search.placeholder')}
          candidates={joinFields?.map((field) => ({ id: field.id, name: field.name }))}
          selectedId={value?.on?.[1]}
          onChange={(columnId) => onChange({ ...value, on: [value?.on?.[0] ?? '', columnId] })}
        />
      </div>
    </div>
  );
};

const JoinTypeSelector = (props: {
  value?: BaseQueryJoinType;
  onChange: (value: BaseQueryJoinType) => void;
}) => {
  const { value, onChange } = props;
  const { t } = useTranslation();
  const joinStatic = useMemo(
    () => [
      {
        id: BaseQueryJoinType.Left,
        name: t('baseQuery.join.leftJoin'),
      },
      {
        id: BaseQueryJoinType.Right,
        name: t('baseQuery.join.rightJoin'),
      },
      {
        id: BaseQueryJoinType.Inner,
        name: t('baseQuery.join.innerJoin'),
      },
      {
        id: BaseQueryJoinType.Full,
        name: t('baseQuery.join.fullJoin'),
      },
    ],
    [t]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center">
          <Badge className="text-xs">{joinStatic.find((join) => join.id === value)?.name}</Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{t('baseQuery.join.joinType')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => onChange(value as BaseQueryJoinType)}
        >
          {joinStatic.map((join) => (
            <DropdownMenuRadioItem key={join.id} value={join.id}>
              {join.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
