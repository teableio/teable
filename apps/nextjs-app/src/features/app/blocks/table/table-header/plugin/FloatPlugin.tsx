import { DragHandleDots2Icon } from '@radix-ui/react-icons';
import { X } from '@teable/icons';
import { PluginPosition } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Rnd } from 'react-rnd';
import { PluginContent } from '@/features/app/components/plugin/PluginContent';
import { useFloatPluginPosition } from './useFloatPluginPosition';

export const FloatPlugin = (props: {
  pluginId: string;
  name: string;
  pluginUrl?: string;
  onClose?: () => void;
}) => {
  const { pluginId, pluginUrl, name, onClose } = props;
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const { position, updatePosition } = useFloatPluginPosition(pluginId);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = document.body.getBoundingClientRect();
      const { x, y, width: w, height: h } = position;
      const newWidth = w > width ? Math.max(120, width - 20) : w;
      const newHeight = h > height ? Math.max(90, height - 20) : h;

      let newX = x;
      let newY = y;
      if (x + w > width) {
        newX = Math.max(0, width - w);
      }
      if (y + h > height) {
        newY = Math.max(0, height - h);
      }
      updatePosition({
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      });
    });

    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
    };
  }, [position, updatePosition]);

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <Rnd
      className="fixed overflow-hidden rounded-sm border bg-background"
      style={{
        position: 'fixed',
        zIndex: 100,
      }}
      position={{
        x: position.x,
        y: position.y,
      }}
      size={{
        width: position.width,
        height: position.height,
      }}
      dragHandleClassName="float-plugin-drag-handle"
      resizeHandleClasses={{
        bottomRight:
          'border-b border-r border-foreground/40 after:absolute after:size-2 after:border-b-2 after:border-r-2 after:border-b after:border-r after:border-primary',
      }}
      minHeight={90}
      minWidth={120}
      enableResizing={{
        bottomRight: true,
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
    >
      <div className="flex size-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-1">
          <div className="flex items-center gap-2 overflow-hidden">
            <DragHandleDots2Icon className="float-plugin-drag-handle inline-block size-4 shrink-0 cursor-move" />
            <div className="truncate">{name}</div>
          </div>
          <Button variant="link" size="icon" onClick={onClose}>
            <X />
          </Button>
        </div>
        <PluginContent
          className="flex-1"
          baseId={baseId}
          pluginId={pluginId}
          positionId={baseId}
          pluginUrl={pluginUrl}
          positionType={PluginPosition.Float}
          dragging={isDragging}
        />
      </div>
    </Rnd>,
    document.body
  );
};
