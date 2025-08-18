import { Table2 } from '@teable/icons';
import type { ITableFullVo, ITableListVo, IToolInvocationUIPart } from '@teable/openapi';
import { McpToolInvocationName } from '@teable/openapi';
import { hexToRGBA } from '@teable/sdk/components';
import { useTables } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import type { IToolMessagePart } from '../ToolMessagePart';
import { PreviewActionColorMap } from './constant';

interface ITableListPreviewProps {
  toolInvocation: IToolMessagePart['part']['toolInvocation'];
}

const TableItem = (props: {
  id: string;
  name: string;
  icon: string | undefined;
  style?: React.CSSProperties;
  changeTableId?: string;
  tables: ITableListVo;
}) => {
  const { id, name, icon, style, changeTableId, tables } = props;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!changeTableId) {
      return;
    }
    if (ref.current && id === changeTableId) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [changeTableId, id]);
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const currentTableId = router.query.tableId as string;
  const isExpired = !tables.find((table) => table.id === id);

  return (
    <Button
      style={style}
      variant={'ghost'}
      className={'flex h-7 items-center gap-2 rounded border p-1 px-2 text-foreground'}
      ref={ref}
      disabled={isExpired}
      onClick={(e) => {
        e.stopPropagation();
        if (id === currentTableId || isExpired) {
          return;
        }
        router.push(
          {
            pathname: `/base/[baseId]/[tableId]/`,
            query: {
              baseId,
              tableId: id,
            },
          },
          undefined,
          {
            shallow: Boolean(id),
          }
        );
      }}
    >
      {icon ? (
        <Emoji emoji={icon} size={'1rem'} className="size-4 shrink-0" />
      ) : (
        <Table2 className="size-4 shrink-0" />
      )}
      <p className="grow truncate text-left text-xs">{' ' + name}</p>
    </Button>
  );
};

export const TableListDiffPreview = (props: ITableListPreviewProps) => {
  const { toolInvocation } = props;

  const tables = useTables();

  const changeTableId = useMemo(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.CreateTable: {
        let result: {
          table: ITableFullVo;
        };
        const newToolInvocation =
          toolInvocation as unknown as IToolInvocationUIPart['toolInvocation'];
        try {
          const resultText = newToolInvocation?.result?.content?.[0]?.text;
          result = JSON.parse(resultText);
          return result?.table?.id;
        } catch (e) {
          console.error(e);
        }
        return null;
      }
      case McpToolInvocationName.UpdateTableName:
      case McpToolInvocationName.DeleteTable: {
        const { tableId } = toolInvocation.args;
        return tableId;
      }
      default: {
        return null;
      }
    }
  }, [toolInvocation]);

  /* eslint-disable sonarjs/cognitive-complexity */
  const tableList = useMemo<
    {
      id: string;
      name: string;
      icon: string | undefined;
      style?: React.CSSProperties;
    }[]
  >(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.CreateTable: {
        let table: ITableFullVo;
        const newToolInvocation =
          toolInvocation as unknown as IToolInvocationUIPart['toolInvocation'];
        try {
          const resultText = newToolInvocation?.result?.content?.[0]?.text;
          const result = JSON.parse(resultText);
          table = result?.table;
        } catch (e) {
          console.error(e);
          return tables.map((table) => ({
            id: table.id,
            name: table.name,
            icon: table.icon,
          }));
        }

        const tableId = table?.id;

        const newTables = tables.map((table) => ({
          id: table.id,
          name: table.name,
          icon: table.icon,
          style: {},
        }));

        const tableExist = !!newTables.find((table) => table.id === tableId);

        if (tableExist) {
          return tables.map((table) => {
            return {
              id: table.id,
              name: table.name,
              icon: table.icon,
              style:
                changeTableId === table.id
                  ? {
                      backgroundColor: hexToRGBA(PreviewActionColorMap['create'], 0.5),
                      borderColor: PreviewActionColorMap['create'],
                    }
                  : {},
            };
          });
        } else {
          newTables.push({
            id: table?.id,
            name: table?.name,
            icon: table?.icon,
            style: {
              backgroundColor: hexToRGBA(PreviewActionColorMap['expired'], 0.5),
              borderColor: PreviewActionColorMap['expired'],
            },
          });
          return newTables;
        }
      }
      case McpToolInvocationName.UpdateTableName: {
        const { tableId, updateTableNameRo } = toolInvocation.args;
        const { name: newName } = updateTableNameRo;
        const isExpired = !tables.find((table) => table.id === tableId);

        if (isExpired) {
          const newTables = tables.map((table) => ({
            id: table.id,
            name: table.name,
            icon: table.icon,
            style: {},
          }));

          newTables.push({
            id: tableId,
            name: newName,
            icon: undefined,
            style: {
              backgroundColor: hexToRGBA(PreviewActionColorMap['expired'], 0.5),
              borderColor: PreviewActionColorMap['expired'],
            },
          });
          return newTables;
        } else {
          return tables.map((table) => ({
            id: table.id,
            name: tableId === table.id ? newName : table.name,
            icon: table.icon,
            style:
              tableId === table.id
                ? {
                    backgroundColor: hexToRGBA(PreviewActionColorMap['update'], 0.5),
                    borderColor: PreviewActionColorMap['update'],
                  }
                : undefined,
          }));
        }
      }
      case McpToolInvocationName.DeleteTable: {
        const { tableId } = toolInvocation.args;

        const isExpired = !tables.find((table) => table.id === tableId);

        if (isExpired) {
          const newToolInvocation =
            toolInvocation as unknown as IToolInvocationUIPart['toolInvocation'];
          let deletedTable: {
            id: string;
            name: string;
            icon: string | undefined;
            order: number;
          };
          try {
            deletedTable = JSON.parse(newToolInvocation?.result?.content?.[0]?.text);
          } catch (e) {
            console.error(e);
            return tables.map((table) => ({
              id: table.id,
              name: table.name,
              icon: table.icon,
              style: {},
            }));
          }
          const newTables = tables.map((table) => ({
            id: table.id,
            name: table.name,
            icon: table.icon,
            style: {},
          }));

          newTables.splice(deletedTable?.order ?? tables.length, 0, {
            id: tableId,
            name: deletedTable?.name,
            icon: undefined,
            style: {
              backgroundColor: hexToRGBA(PreviewActionColorMap['expired'], 0.5),
              borderColor: PreviewActionColorMap['expired'],
            },
          });
          return newTables;
        } else {
          return tables.map((table) => {
            return {
              id: table.id,
              name: table.name,
              icon: table.icon,
              style:
                tableId === table.id
                  ? {
                      backgroundColor: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
                      borderColor: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
                    }
                  : undefined,
            };
          });
        }
      }
      default: {
        return tables.map((table) => ({ id: table.id, name: table.name, icon: table.icon }));
      }
    }
  }, [changeTableId, tables, toolInvocation]);

  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
      {tableList.map((table) => (
        <TableItem key={table.id} {...table} tables={tables} changeTableId={changeTableId} />
      ))}
    </div>
  );
};
