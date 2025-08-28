import { Table2 } from '@teable/icons';
import type { IBaseErdTableNode } from '@teable/openapi';
import type { useFieldStaticGetter } from '@teable/sdk/hooks';
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { Handle, Position } from 'reactflow';
import { Emoji } from '../../components/emoji/Emoji';

interface IBaseErdTableNodeProps extends IBaseErdTableNode {
  baseId: string;
  fieldStaticGetter: ReturnType<typeof useFieldStaticGetter>;
  openTable: (baseId: string, tableId: string) => void;
}

export const BaseErdTableNode = memo(({ data }: NodeProps<IBaseErdTableNodeProps>) => {
  const {
    id: tableId,
    name,
    fields,
    fieldStaticGetter,
    icon,
    crossBaseId,
    crossBaseName,
    openTable,
    baseId,
  } = data;

  const title = crossBaseName ? `${name}(${crossBaseName})` : name;
  const fieldComponents = fields.map((field) => {
    const { Icon } = fieldStaticGetter(field.type, {
      isLookup: field.isLookup,
      hasAiConfig: false,
      deniedReadRecord: false,
    });

    return (
      <div key={field.id} className="relative flex h-6 w-full items-center p-2">
        <div className="flex w-full items-center gap-2">
          <Icon className="size-4 shrink-0" />
          <span className=" truncate" title={field.name}>
            {field.name}
          </span>
        </div>
        <Handle
          id={field.id}
          type="source"
          position={Position.Right}
          isConnectable={false}
          className="opacity-0"
        />
        <Handle
          id={field.id}
          type="target"
          position={Position.Left}
          isConnectable={false}
          className="opacity-0"
        />
      </div>
    );
  });

  return (
    <div key={tableId} className="min-w-28 max-w-36 rounded-md border bg-white ">
      <div
        className=" flex h-10 items-center gap-2 border-b px-2 py-4"
        onDoubleClick={() => openTable(crossBaseId ?? baseId, tableId)}
      >
        {icon ? (
          <Emoji className="size-4 shrink-0" emoji={icon} size={'1rem'} />
        ) : (
          <Table2 className="size-4 shrink-0" />
        )}
        <span className="text-md  truncate font-bold" title={title}>
          {title}
        </span>
      </div>
      <div className="flex w-full cursor-default flex-col gap-2 py-2 text-sm">
        {fieldComponents}
      </div>
    </div>
  );
});

BaseErdTableNode.displayName = 'BaseErdTableNode';
