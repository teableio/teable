import { FieldType } from '@teable/core';
import { buttonReset } from '@teable/openapi';
import { Record, useFields, useTablePermission } from '@teable/sdk';
import type { IActiveCell, IGridRef, IRecordIndexMap } from '@teable/sdk';
import { Button, sonner } from '@teable/ui-lib';
import { RotateCcwIcon } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
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
  const record = activeCell?.rowIndex !== undefined ? recordMap[activeCell.rowIndex] : undefined;
  const { fieldId } = activeCell || {};
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const field = fields.find((f) => f.id === fieldId);

  const onPositionChanged = useCallback(() => {
    if (!activeCell || !permission['record|update']) {
      return setStyle(null);
    }

    const { fieldId, columnIndex, rowIndex } = activeCell;
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
  }, [activeCell, gridRef, permission, record, field]);

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

  const resetClickCount = useCallback(async () => {
    if (!activeCell || !field || !record) return;
    await buttonReset(field.tableId, record.id, field.id);
    toast.success(t('sdk:common.resetSuccess'));
  }, [activeCell, field, record, t]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

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
