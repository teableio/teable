import { useMutation } from '@tanstack/react-query';
import { RefreshCcw } from '@teable/icons';
import { autoFillCell } from '@teable/openapi';
import {
  Record,
  TaskStatusCollectionContext,
  useFields,
  useTableId,
  useTableListener,
  useTablePermission,
} from '@teable/sdk';
import type { IActiveCell, IGridRef, IRecordIndexMap } from '@teable/sdk';
import { Button } from '@teable/ui-lib';
import React, {
  useCallback,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useContext,
  useState,
} from 'react';

interface IAIButtonProps {
  gridRef: React.RefObject<IGridRef>;
  activeCell?: IActiveCell;
  recordMap: IRecordIndexMap;
  onGenerate?: () => void;
}

export const AiGenerateButton = forwardRef<{ onScrollHandler: () => void }, IAIButtonProps>(
  (props, ref) => {
    const { gridRef, activeCell, recordMap } = props;
    const tableId = useTableId() as string;
    const fields = useFields();
    const permission = useTablePermission();
    const taskStatusCollection = useContext(TaskStatusCollectionContext);
    const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [style, setStyle] = React.useState<React.CSSProperties | null>(null);
    // Track local loading state - waiting for taskProcessing message
    const [pendingCell, setPendingCell] = useState<{ recordId: string; fieldId: string } | null>(
      null
    );

    const { mutate: mutateGenerate } = useMutation({
      mutationFn: ({ recordId, fieldId }: { recordId: string; fieldId: string }) =>
        autoFillCell(tableId, recordId, fieldId),
      onError: () => {
        // Clear pending state if API call fails
        setPendingCell(null);
      },
    });

    // Clear pending state when any task event is received
    // Task events don't include cell-specific payload, so we clear pendingCell
    // when the task enters the queue (star animation takes over) or completes
    const handleTaskEvent = useCallback(() => {
      if (!pendingCell) return;
      setPendingCell(null);
    }, [pendingCell]);

    useTableListener(
      tableId,
      ['taskProcessing', 'taskCompleted', 'taskCancelled', 'taskFailed'],
      handleTaskEvent
    );

    // Check if cell is currently being processed by task queue (showing star animation)
    const isCellInTaskQueue = (cell?: IActiveCell) => {
      if (!cell || !taskStatusCollection?.cells) return false;
      return taskStatusCollection.cells.some(
        (c) => c.recordId === cell.recordId && c.fieldId === cell.fieldId
      );
    };

    // Check if this cell is in local pending state (waiting for taskProcessing)
    const isLocalPending =
      pendingCell &&
      activeCell &&
      pendingCell.recordId === activeCell.recordId &&
      pendingCell.fieldId === activeCell.fieldId;

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
      if (!activeCell || isCellInTaskQueue(activeCell) || isLocalPending) return;

      props.onGenerate?.();

      // Set local pending state immediately
      setPendingCell({
        recordId: activeCell.recordId,
        fieldId: activeCell.fieldId,
      });
      // Fire the API call
      mutateGenerate({
        recordId: activeCell.recordId,
        fieldId: activeCell.fieldId,
      });
    };

    // Hide button when cell is in task queue (star animation is showing)
    if (!style || isCellInTaskQueue(activeCell)) return null;

    return (
      <div className="absolute z-50 rounded-lg border bg-background" style={style}>
        <Button variant="outline" size="sm" onClick={onGenerate} disabled={!!isLocalPending}>
          <RefreshCcw className={isLocalPending ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>
    );
  }
);

AiGenerateButton.displayName = 'AiGenerateButton';
