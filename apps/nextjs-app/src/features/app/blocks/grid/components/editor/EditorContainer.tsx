/* eslint-disable jsx-a11y/no-static-element-interactions */
import { clamp, pick } from 'lodash';
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import { GRID_DEFAULT } from '../../configs';
import { useKeyboardSelection } from '../../hooks';
import type { IInteractionLayerProps } from '../../InteractionLayer';
import type { ICellItem, IScrollState, ISelectionState } from '../../interface';
import { SelectionRegionType } from '../../interface';
import type { ICell, IInnerCell } from '../../renderers';
import { CellType, EditorPosition } from '../../renderers';
import { isPrintableKey } from '../../utils';
import { BooleanEditor } from './BooleanEditor';
import { SelectEditor } from './SelectEditor';
import { TextEditor } from './TextEditor';

export interface IEditorContainerProps
  extends Pick<
    IInteractionLayerProps,
    | 'theme'
    | 'coordInstance'
    | 'scrollTo'
    | 'getCellContent'
    | 'onCopy'
    | 'onPaste'
    | 'onDelete'
    | 'onRowAppend'
    | 'onCellActivated'
  > {
  isEditing?: boolean;
  scrollState: IScrollState;
  activeCell: ICellItem | null;
  setActiveCell: React.Dispatch<React.SetStateAction<ICellItem | null>>;
  selectionState: ISelectionState;
  setSelectionState: React.Dispatch<React.SetStateAction<ISelectionState>>;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  onChange?: (cell: ICellItem, cellValue: IInnerCell) => void;
}

export interface IEditorRef<T extends IInnerCell = IInnerCell> {
  focus?: () => void;
  setValue?: (data: T['data']) => void;
  saveValue?: () => void;
}

export interface IEditorProps<T extends IInnerCell = IInnerCell> {
  cell: T;
  style?: CSSProperties;
  isEditing?: boolean;
  setEditing?: React.Dispatch<React.SetStateAction<boolean>>;
  onChange?: (value: unknown) => void;
}

export interface IEditorContainerRef {
  focus?: () => void;
  saveValue?: () => void;
}

export const EditorContainerBase: ForwardRefRenderFunction<
  IEditorContainerRef,
  IEditorContainerProps
> = (props: IEditorContainerProps, ref) => {
  const {
    theme,
    isEditing,
    coordInstance,
    scrollState,
    activeCell,
    selectionState,
    scrollTo,
    onCopy,
    onPaste,
    onChange,
    onDelete,
    onRowAppend,
    setEditing,
    setActiveCell,
    setSelectionState,
    onCellActivated,
    getCellContent,
  } = props;
  const { scrollLeft, scrollTop } = scrollState;
  const { type: selectionType } = selectionState;
  const isCellSelection = selectionType === SelectionRegionType.Cells;
  const [columnIndex, rowIndex] = activeCell ?? [-1, -1];
  const cellContent = useMemo(
    () => getCellContent([columnIndex, rowIndex]) as IInnerCell,
    [columnIndex, getCellContent, rowIndex]
  );
  const {
    type: cellType,
    readonly,
    customEditor,
    editorPosition = EditorPosition.Overlap,
  } = cellContent;
  const editingEnable = !readonly && isEditing && activeCell;
  const width = coordInstance.getColumnWidth(columnIndex) + 4;
  const height = coordInstance.getRowHeight(rowIndex) + 4;
  const editorRef = useRef<IEditorRef | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    saveValue: () => editorRef.current?.saveValue?.(),
  }));

  const editorStyle = useMemo(
    () =>
      (editingEnable
        ? { pointerEvents: 'auto', minWidth: width, minHeight: height }
        : { pointerEvents: 'none', opacity: 0, width: 0, height: 0 }) as React.CSSProperties,
    [editingEnable, height, width]
  );

  const wrapStyle = useMemo(() => {
    if (!editingEnable) return;
    const { rowInitSize, columnInitSize, containerWidth, containerHeight } = coordInstance;
    const rowHeight = coordInstance.getRowHeight(columnIndex);
    const verticalPositionMap = {
      [EditorPosition.Overlap]: -1.5,
      [EditorPosition.Below]: rowHeight + 1.5,
      [EditorPosition.Above]: -rowHeight - 1.5,
    };
    const top = clamp(
      coordInstance.getRowOffset(rowIndex) - scrollTop + verticalPositionMap[editorPosition],
      rowInitSize - 1,
      containerHeight - height + 1
    );
    const left = clamp(
      coordInstance.getColumnOffset(columnIndex) - scrollLeft - 1.5,
      columnInitSize - 1,
      containerWidth - width
    );

    return {
      top,
      left,
    };
  }, [
    coordInstance,
    editorPosition,
    columnIndex,
    rowIndex,
    scrollLeft,
    scrollTop,
    width,
    height,
    editingEnable,
  ]);

  useEffect(() => {
    if ((cellContent as ICell).type === CellType.Loading) return;
    if (!activeCell) return;
    editorRef.current?.setValue?.(cellContent.data);
    requestAnimationFrame(() => editorRef.current?.focus?.());
  }, [cellContent, activeCell]);

  useKeyboardSelection({
    cell: cellContent,
    isEditing,
    activeCell,
    scrollState,
    selectionState,
    coordInstance,
    scrollTo,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    setEditing,
    setActiveCell,
    setSelectionState,
    onCellActivated,
    editorRef,
  });

  const onChangeInner = (value: unknown) => {
    onChange?.([columnIndex, rowIndex], {
      ...cellContent,
      data: value,
    } as IInnerCell);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isCellSelection || isEditing) return;
    if (!isPrintableKey(event.nativeEvent)) return;
    setEditing(true);
    editorRef.current?.setValue?.('');
  };

  const onCopyInner = () => {
    const selection = pick(selectionState, ['type', 'ranges']);
    onCopy?.(selection);
  };

  const onPasteInner = () => {
    const selection = pick(selectionState, ['type', 'ranges']);
    onPaste?.(selection);
  };

  function Editor() {
    if (readonly) return;
    switch (cellType) {
      case CellType.Text:
      case CellType.Number: {
        const { rowHeight: defaultRowHeight } = GRID_DEFAULT;
        return (
          <TextEditor
            ref={editorRef}
            cell={cellContent}
            style={{
              ...editorStyle,
              borderColor: theme.cellLineColorActived,
              textAlign: cellType === CellType.Number ? 'right' : 'left',
              paddingBottom: height > defaultRowHeight ? height - defaultRowHeight : 0,
            }}
            onChange={onChangeInner}
          />
        );
      }
      case CellType.Boolean:
        return <BooleanEditor ref={editorRef} cell={cellContent} onChange={onChangeInner} />;
      case CellType.Select:
        return (
          <SelectEditor
            ref={editorRef}
            cell={cellContent}
            style={editorStyle}
            isEditing={isEditing}
            onChange={onChangeInner}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="click-outside-ignore absolute top-0 left-0 pointer-events-none">
      <div
        className="absolute z-10"
        style={wrapStyle}
        onCopy={onCopyInner}
        onPaste={onPasteInner}
        onKeyDown={onKeyDown}
      >
        {customEditor
          ? customEditor(
              {
                style: editorStyle,
                cell: cellContent as unknown as IInnerCell,
                isEditing,
                setEditing,
                onChange: onChangeInner,
              },
              editorRef
            )
          : Editor()}
      </div>
    </div>
  );
};

export const EditorContainer = forwardRef(EditorContainerBase);
