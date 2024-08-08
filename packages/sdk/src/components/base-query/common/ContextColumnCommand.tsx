import { Check } from '@teable/icons';
import type { IBaseQueryColumn } from '@teable/openapi';
import {
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable/ui-lib';
import { groupBy } from 'lodash';
import { useMemo } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useTables } from '../../../hooks';
import { useAllColumns } from './useAllColumns';

export const ContextColumnsCommand = (props: {
  checked?: string[] | string;
  isFilter?: boolean;
  onClick?: (
    column: IBaseQueryColumn,
    options: {
      preSelected?: boolean;
      group?: { id: string; name: string };
    }
  ) => void;
}) => {
  const { checked, onClick, isFilter } = props;
  const { t } = useTranslation();
  const columns = useAllColumns(isFilter);
  const tables = useTables();
  const checkedArray = useMemo(
    () => (typeof checked === 'string' && checked ? [checked] : checked) as string[],
    [checked]
  );

  const { noGroupedColumns, groupedColumns, columnMap } = useMemo(() => {
    const noGroupedColumns = columns.filter((column) => !column.groupTableId);
    const groupedColumns = groupBy(
      columns.filter((column) => column.groupTableId),
      'groupTableId'
    );
    const columnMap = columns.reduce(
      (pre, cur) => {
        pre[cur.column] = cur;
        return pre;
      },
      {} as Record<string, IBaseQueryColumn>
    );
    return { noGroupedColumns, groupedColumns, columnMap };
  }, [columns]);

  const groupMap = useMemo(() => {
    return tables.reduce(
      (pre, cur) => {
        pre[cur.id] = cur;
        return pre;
      },
      {} as Record<string, { id: string; name: string }>
    );
  }, [tables]);

  return (
    <Command
      filter={(value, search) => {
        if (!search) return 1;
        const item = columnMap[value];
        const text = item.name;
        if (text?.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return 1;
        return 0;
      }}
    >
      <CommandInput placeholder={t('common.search.placeholder')} />
      <CommandEmpty>{t('common.empty')}</CommandEmpty>
      <CommandList>
        <CommandGroup>
          {noGroupedColumns.map((column) => {
            const isSelected = checkedArray?.some((item) => item === column.column);
            return (
              <CommandItem
                key={column.column}
                value={column.column}
                onSelect={() => {
                  onClick?.(column, {
                    preSelected: isSelected,
                  });
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 flex-shrink-0',
                    isSelected ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span className="ml-2 truncate">{column.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        {Object.keys(groupedColumns).map((group) => (
          <CommandGroup key={group} heading={groupMap[group].name}>
            {groupedColumns[group].map((column) => {
              const isSelected = checkedArray?.some((item) => item === column.column);
              return (
                <CommandItem
                  key={column.column}
                  value={column.column}
                  onSelect={() => {
                    onClick?.(column, {
                      preSelected: isSelected,
                      group: {
                        id: group,
                        name: groupMap[group].name,
                      },
                    });
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 flex-shrink-0',
                      isSelected ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="ml-2 truncate">{column.name}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
};
