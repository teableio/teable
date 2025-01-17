import type { DragEvent } from 'react';
import { useRef } from 'react';
import type { IGridRef } from '../../grid/Grid';
import { SelectionRegionType, type ICellItem } from '../../grid/interface';
import { CombinedSelection, emptySelection } from '../../grid/managers';

interface IUseGridFileEventProps {
  gridRef: React.RefObject<IGridRef>;
  onValidation: (cell: ICellItem) => boolean;
  onCellDrop: (cell: ICellItem, files: FileList) => Promise<void> | void;
}

export const useGridFileEvent = (props: IUseGridFileEventProps) => {
  const { gridRef, onValidation, onCellDrop } = props;
  const dropTargetRef = useRef<ICellItem | null>(null);

  const getDropCell = (event: DragEvent): ICellItem | null => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return gridRef.current?.getCellIndicesAtPosition(x, y) ?? null;
  };

  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    gridRef.current?.setSelection(emptySelection);
  };

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!onCellDrop) return;

    const cell = getDropCell(event);

    if (!cell || !onValidation(cell)) return;

    dropTargetRef.current = cell;

    const newSelection = new CombinedSelection(SelectionRegionType.Cells, [cell, cell]);
    gridRef.current?.setSelection(newSelection);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    gridRef.current?.setSelection(emptySelection);

    if (!onCellDrop || !dropTargetRef.current) return;

    const files = event.dataTransfer?.files;

    if (!files?.length) return;

    onCellDrop(dropTargetRef.current, files);
    dropTargetRef.current = null;
  };

  return {
    onDragOver,
    onDragLeave,
    onDrop,
  };
};
