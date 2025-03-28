import { useMutation } from '@tanstack/react-query';
import { Loader2, RefreshCcw } from '@teable/icons';
import { autoFillCell } from '@teable/openapi';
import { useFields, useTableId } from '@teable/sdk';
import type { IActiveCell, IGridRef } from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import React, { useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

interface IAIButtonProps {
  gridRef: React.RefObject<IGridRef>;
  activeCell?: IActiveCell;
}

export const AiGenerateButton = forwardRef<{ onScrollHandler: () => void }, IAIButtonProps>(
  ({ gridRef, activeCell }, ref) => {
    const tableId = useTableId() as string;
    const fields = useFields();
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [style, setStyle] = React.useState<React.CSSProperties | null>(null);

    const { mutate: mutateGenerate, isLoading } = useMutation({
      mutationFn: ({ recordId, fieldId }: { recordId: string; fieldId: string }) =>
        autoFillCell(tableId, recordId, fieldId),
    });

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

    const onPositionChanged = useCallback(() => {
      if (!activeCell) {
        return setStyle(null);
      }

      const { fieldId, columnIndex, rowIndex } = activeCell;

      const field = fields.find((f) => f.id === fieldId);

      if (!field?.aiConfig?.type) {
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
    }, [activeCell, fields, gridRef]);

    useEffect(() => {
      onPositionChanged();
    }, [activeCell, onPositionChanged]);

    useEffect(() => {
      return () => {
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    }, []);

    const onGenerate = () => {
      if (!activeCell || isLoading) return;
      mutateGenerate({
        recordId: activeCell.recordId,
        fieldId: activeCell.fieldId,
      });
    };

    if (!style) return null;

    return (
      <div className="absolute z-50" style={style}>
        <Button
          variant="outline"
          size="sm"
          className="disabled:opacity-100"
          onClick={onGenerate}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCcw className="size-4" />
          )}
        </Button>
      </div>
    );
  }
);

AiGenerateButton.displayName = 'AiGenerateButton';
