import { DragHandleDots2Icon } from '@radix-ui/react-icons';
import { X } from '@teable/icons';
import { PluginPosition } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';
import { useFloatPluginPosition } from './useFloatPluginPosition';

export const FloatPlugin = (props: {
  name: string;
  tableId: string;
  pluginId: string;
  pluginUrl?: string;
  pluginInstallId: string;
  positionId: string;
  onClose?: () => void;
}) => {
  const { tableId, pluginInstallId, pluginId, pluginUrl, name, onClose, positionId } = props;
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const { position, updatePosition, frozenResize, frozenDrag } = useFloatPluginPosition(
    tableId,
    pluginInstallId
  );
  const [isDragging, setIsDragging] = useState(false);
  const [bodySize, setBodySize] = useState({
    width: document.body.clientWidth,
    height: document.body.clientHeight,
  });
  const preBody = useRef<{ width: number; height: number }>({
    width: document.body.clientWidth,
    height: document.body.clientHeight,
  });

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = document.body.getBoundingClientRect();
      if (preBody.current.width === width && preBody.current.height === height) {
        return;
      }
      setBodySize({ width, height });
      preBody.current = { width, height };
    });

    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
    };
  }, [position, updatePosition]);

  const x =
    position.x + position.width > bodySize.width
      ? Math.max(0, bodySize.width - position.width)
      : position.x;
  const y =
    position.y + position.height > bodySize.height
      ? Math.max(0, bodySize.height - position.height)
      : position.y;
  const width = position.width > bodySize.width ? Math.max(120, bodySize.width) : position.width;
  const height =
    position.height > bodySize.height ? Math.max(90, bodySize.height) : position.height;

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <Rnd
      className="!max-h-full !max-w-full overflow-hidden rounded-sm border bg-background"
      style={{
        position: 'fixed',
        zIndex: 10000,
      }}
      position={{
        x,
        y,
      }}
      size={{
        width,
        height,
      }}
      dragHandleClassName="float-plugin-drag-handle"
      resizeHandleClasses={{
        bottomRight:
          'border-b border-r border-foreground/40 after:absolute after:size-2 after:border-b-2 after:border-r-2 after:border-b after:border-r after:border-primary',
      }}
      minHeight={90}
      minWidth={120}
      enableResizing={{
        bottomRight: !frozenResize,
      }}
      bounds={'parent'}
      onDrag={() => {
        setIsDragging(true);
      }}
      onResize={() => {
        setIsDragging(true);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        setIsDragging(false);
        updatePosition({
          ...position,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        });
      }}
      onDragStop={(_e, d) => {
        updatePosition({
          ...position,
          x: d.x,
          y: d.y,
        });
        setIsDragging(false);
      }}
      disableDragging={frozenDrag}
      disableResizing={frozenResize}
    >
      <div className="flex size-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-1">
          <div className="flex items-center gap-2 overflow-hidden">
            {!frozenDrag && (
              <DragHandleDots2Icon className="float-plugin-drag-handle inline-block size-4 shrink-0 cursor-move" />
            )}
            <div className={cn('truncate', { 'ml-2': frozenDrag })}>{name}</div>
          </div>
          <Button variant="link" size="icon" onClick={onClose}>
            <X />
          </Button>
        </div>
        <PluginContent
          className="flex-1"
          baseId={baseId}
          tableId={tableId}
          pluginId={pluginId}
          pluginInstallId={pluginInstallId}
          positionId={positionId}
          pluginUrl={pluginUrl}
          positionType={PluginPosition.ContextMenu}
          dragging={isDragging}
          iframeAttributes={{
            loading: 'eager',
          }}
        />
      </div>
    </Rnd>,
    document.body
  );
};
