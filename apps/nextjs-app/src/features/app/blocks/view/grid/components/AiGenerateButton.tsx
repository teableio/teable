import { useMutation } from '@tanstack/react-query';
import { Loader2, RefreshCcw } from '@teable/icons';
import { autoFillCell } from '@teable/openapi';
import { Record, useFields, useTableId, useTablePermission } from '@teable/sdk';
import type { IActiveCell, IGridRef, IRecordIndexMap } from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import React, { useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

interface IAIButtonProps {
  gridRef: React.RefObject<IGridRef>;
  activeCell?: IActiveCell;
  recordMap: IRecordIndexMap;
}

export const AiGenerateButton = forwardRef<{ onScrollHandler: () => void }, IAIButtonProps>(
  (props, ref) => {
    const { gridRef, activeCell, recordMap } = props;
    const tableId = useTableId() as string;
    const fields = useFields();
    const permission = useTablePermission();
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [style, setStyle] = React.useState<React.CSSProperties | null>(null);
    const [generatingCells, setGeneratingCells] = React.useState<Set<string>>(new Set());

    const { mutate: mutateGenerate } = useMutation({
      mutationFn: ({ recordId, fieldId }: { recordId: string; fieldId: string }) =>
        autoFillCell(tableId, recordId, fieldId),
      onMutate: ({ recordId, fieldId }) => {
        const cellKey = `${recordId}:${fieldId}`;
        setGeneratingCells((prev) => new Set(prev).add(cellKey));
        return { recordId, fieldId };
      },
      onSettled: (_, __, context) => {
        if (context) {
          const cellKey = `${context.recordId}:${context.fieldId}`;
          setGeneratingCells((prev) => {
            const updated = new Set(prev);
            updated.delete(cellKey);
            return updated;
          });
        }
      },
    });

    const isCellGenerating = (cell?: IActiveCell) => {
      if (!cell) return false;
      return generatingCells.has(`${cell.recordId}:${cell.fieldId}`);
    };

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

    const record = activeCell?.rowIndex ? recordMap[activeCell.rowIndex] : undefined;

    const onPositionChanged = useCallback(() => {
      if (!activeCell || !permission['record|update']) {
        return setStyle(null);
      }

      const { fieldId, columnIndex, rowIndex } = activeCell;

      const field = fields.find((f) => f.id === fieldId);

      if (
        Record.isLocked(record?.permissions, fieldId) ||
        Record.isHidden(record?.permissions, fieldId)
      ) {
        return setStyle(null);
      }

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
    }, [activeCell, fields, gridRef, permission, record]);

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
      if (!activeCell || isCellGenerating(activeCell)) return;
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
          disabled={isCellGenerating(activeCell)}
        >
          {isCellGenerating(activeCell) ? (
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
