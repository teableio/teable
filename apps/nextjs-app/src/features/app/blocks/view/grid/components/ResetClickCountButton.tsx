import { FieldType } from '@teable/core';
import { Record, useFields, useTablePermission } from '@teable/sdk';
import type { IActiveCell, IGridRef, IRecordIndexMap } from '@teable/sdk';
import { Button, sonner } from '@teable/ui-lib';
import { RotateCcwIcon } from 'lucide-react';
import React, { useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const { toast } = sonner;

interface IResetClickCountButtonProps {
  gridRef: React.RefObject<IGridRef>;
  activeCell?: IActiveCell;
  recordMap: IRecordIndexMap;
}

export const ResetClickCountButton = forwardRef<
  { onScrollHandler: () => void },
  IResetClickCountButtonProps
>((props, ref) => {
  const { gridRef, activeCell, recordMap } = props;
  const fields = useFields();
  const permission = useTablePermission();
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);
  const record = activeCell?.rowIndex ? recordMap[activeCell.rowIndex] : undefined;
  const { fieldId } = activeCell || {};
  console.log('fixme uno ResetClickCountButton', activeCell);

  const onPositionChanged = useCallback(() => {
    if (!activeCell || !permission['record|update']) {
      return setStyle(null);
    }

    const { fieldId, columnIndex, rowIndex } = activeCell;

    const field = fields.find((f) => f.id === fieldId);

    if (!field || field.type !== FieldType.Button) {
      return setStyle(null);
    }

    if (!field.options?.resetCount) {
      return setStyle(null);
    }

    if (
      Record.isLocked(record?.permissions, fieldId) ||
      Record.isHidden(record?.permissions, fieldId)
    ) {
      return setStyle(null);
    }

    const bounds = gridRef.current?.getCellBounds([columnIndex, rowIndex]);
    if (bounds) {
      const { x, y, width, height } = bounds;
      setStyle({
        left: x + width + 4,
        top: y + (height - 32) / 2,
      });
    }
  }, [activeCell, fields, gridRef, permission, record]);

  useEffect(() => {
    onPositionChanged();
  }, [activeCell, onPositionChanged]);

  useImperativeHandle(ref, () => ({
    onScrollHandler: () => {
      setStyle(null);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        onPositionChanged();
      }, 200);
    },
  }));

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const resetClickCount = async () => {
    if (!activeCell || !fieldId || !record) return;
    await record.updateCell(fieldId, null);
    toast.success('Reset click count successfully');
  };

  if (!style) return null;

  return (
    <div className="absolute z-50" style={style}>
      <Button
        variant="outline"
        size="sm"
        className="disabled:opacity-100"
        onClick={resetClickCount}
      >
        <RotateCcwIcon className="size-4" />
      </Button>
    </div>
  );
});

ResetClickCountButton.displayName = 'ResetClickCountButton';
