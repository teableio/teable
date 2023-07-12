/* eslint-disable jsx-a11y/no-static-element-interactions */
import { clamp } from 'lodash';
import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';
import type { IGridTheme } from '../../configs';
import { useKeyboardSelection } from '../../hooks';
import type { ICellItem, IScrollState, ISelectionState } from '../../interface';
import { SelectionRegionType } from '../../interface';
import type { CoordinateManager } from '../../managers';
import type { IInnerCell } from '../../renderers';
import { CellType } from '../../renderers';
import { isPrintableKey } from '../../utils';
import { SelectEditor } from './SelectEditor';
import { TextEditor } from './TextEditor';

export interface IEditorContainerProps {
  theme: IGridTheme;
  isEditing?: boolean;
  scrollState: IScrollState;
  coordInstance: CoordinateManager;
  selectionState: ISelectionState;
  scrollTo: (sl?: number, st?: number) => void;
  setSelectionState: React.Dispatch<React.SetStateAction<ISelectionState>>;
  getCellContent: (cell: ICellItem) => IInnerCell;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  onChange?: (cell: ICellItem, cellValue: IInnerCell) => void;
  onDelete?: (selectionState: ISelectionState) => void;
  onCellActivated?: (cell: ICellItem) => void;
}

export interface IEditorRef<T extends IInnerCell = IInnerCell> {
  focus: () => void;
  setValue: (data: T['data']) => void;
  saveValue: () => void;
}

export interface IEditorProps<T extends IInnerCell> {
  cell: T;
  style?: CSSProperties;
  isEditing?: boolean;
  onChange?: (value: unknown) => void;
}

export const EditorContainer = (props: IEditorContainerProps) => {
  const {
    theme,
    isEditing,
    coordInstance,
    scrollState,
    selectionState,
    scrollTo,
    onChange,
    onDelete,
    setEditing,
    setSelectionState,
    onCellActivated,
    getCellContent,
  } = props;
  const { scrollLeft, scrollTop } = scrollState;
  const { type: selectionType, ranges: selectionRanges } = selectionState;
  const isCellSelection = selectionType === SelectionRegionType.Cells;
  const [columnIndex, rowIndex] = isCellSelection ? selectionRanges[0] : [-1, -1];
  const { rowInitSize, columnInitSize, containerWidth, containerHeight } = coordInstance;
  const editingEnable = isEditing && columnIndex > -1 && rowIndex > -1;
  const cell = getCellContent([columnIndex, rowIndex]);
  const { data: cellValue, type: cellType } = cell;
  const editorRef = useRef<IEditorRef | null>(null);

  const onChangeInner = (value: unknown) => {
    onChange?.([columnIndex, rowIndex], {
      ...cell,
      data: value,
    } as IInnerCell);
  };

  useEffect(() => {
    if (!isCellSelection || columnIndex < 0 || rowIndex < 0) return;
    editorRef.current?.setValue(cellValue);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [columnIndex, rowIndex, cellValue, isCellSelection]);

  useKeyboardSelection({
    isEditing,
    scrollState,
    selectionState,
    coordInstance,
    scrollTo,
    onDelete,
    setEditing,
    setSelectionState,
    onCellActivated,
    editorRef,
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isCellSelection || isEditing) return;
    if (!isPrintableKey(event.nativeEvent)) return;
    setEditing(true);
    editorRef.current?.setValue('');
  };

  const width = coordInstance.getColumnWidth(columnIndex) + 4;
  const height = coordInstance.getRowHeight(rowIndex) + 4;

  const style = (
    editingEnable
      ? { pointerEvents: 'auto', minWidth: width, minHeight: height }
      : { pointerEvents: 'none', opacity: 0, minWidth: width, minHeight: height }
  ) as React.CSSProperties;

  function Editor() {
    switch (cellType) {
      case CellType.Text:
      case CellType.Number:
        return (
          <TextEditor
            ref={editorRef}
            cell={cell}
            style={{ ...style, borderColor: theme.cellLineColorActived }}
            onChange={onChangeInner}
          />
        );
      case CellType.Select:
        return (
          <SelectEditor
            ref={editorRef}
            cell={cell}
            style={style}
            isEditing={isEditing}
            onChange={onChangeInner}
          />
        );
      default:
        return null;
    }
  }

  const cellOffsetY = new Set([CellType.Select]).has(cellType)
    ? coordInstance.getRowHeight(columnIndex) + 3
    : 0;
  const top = coordInstance.getRowOffset(rowIndex) - scrollTop - 1.5 + cellOffsetY;
  const left = coordInstance.getColumnOffset(columnIndex) - scrollLeft - 1.5;

  return (
    <div className="click-outside-ignore absolute top-0 left-0 pointer-events-none">
      <div
        className="absolute z-10"
        style={{
          top: clamp(top, rowInitSize, containerHeight - height + 1),
          left: clamp(left, columnInitSize - 1, containerWidth - width),
        }}
        onKeyDown={onKeyDown}
      >
        {Editor()}
      </div>
    </div>
  );
};
