/* eslint-disable jsx-a11y/no-static-element-interactions */
import { clamp } from 'lodash';
import type { CSSProperties, ForwardRefRenderFunction } from 'react';
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import { GRID_DEFAULT, type IGridTheme } from '../../configs';
import { useKeyboardSelection } from '../../hooks';
import type { IInteractionLayerProps } from '../../InteractionLayer';
import {
  SelectionRegionType,
  type IActiveCellBound,
  type ICellItem,
  type IRectangle,
  type IScrollState,
} from '../../interface';
import type { CombinedSelection } from '../../managers';
import type { ICell, IInnerCell } from '../../renderers/cell-renderer/interface';
import { CellType } from '../../renderers/cell-renderer/interface';
import { isPrintableKey } from '../../utils';
import { BooleanEditor } from './BooleanEditor';
import { RatingEditor } from './RatingEditor';
import { SelectEditor } from './SelectEditor';
import { TextEditor } from './TextEditor';

export interface IEditorContainerProps
  extends Pick<
    IInteractionLayerProps,
    | 'theme'
    | 'coordInstance'
    | 'scrollToItem'
    | 'real2RowIndex'
    | 'getCellContent'
    | 'onUndo'
    | 'onRedo'
    | 'onCopy'
    | 'onPaste'
    | 'onDelete'
    | 'onRowAppend'
    | 'onRowExpand'
  > {
  isEditing?: boolean;
  scrollState: IScrollState;
  activeCell: ICellItem | null;
  selection: CombinedSelection;
  activeCellBound: IActiveCellBound | null;
  setActiveCell: React.Dispatch<React.SetStateAction<ICellItem | null>>;
  setSelection: React.Dispatch<React.SetStateAction<CombinedSelection>>;
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
  rect: IRectangle;
  theme: IGridTheme;
  style?: CSSProperties;
  isEditing?: boolean;
  setEditing?: React.Dispatch<React.SetStateAction<boolean>>;
  onChange?: (value: unknown) => void;
}

export interface IEditorContainerRef {
  focus?: () => void;
  saveValue?: () => void;
}

const { cellEditorEdgePadding } = GRID_DEFAULT;
const NO_EDITING_CELL_TYPES = new Set([CellType.Boolean, CellType.Rating]);

export const EditorContainerBase: ForwardRefRenderFunction<
  IEditorContainerRef,
  IEditorContainerProps
> = (props, ref) => {
  const {
    theme,
    isEditing,
    coordInstance,
    scrollState,
    activeCell,
    selection,
    activeCellBound,
    scrollToItem,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
    onChange,
    onDelete,
    onRowExpand,
    setEditing,
    setActiveCell,
    setSelection,
    real2RowIndex,
    getCellContent,
  } = props;
  const { scrollLeft, scrollTop } = scrollState;
  const { rowIndex, realRowIndex, columnIndex } = useMemo(() => {
    const [columnIndex, realRowIndex] = activeCell ?? [-1, -1];
    return {
      rowIndex: real2RowIndex(realRowIndex) ?? -1,
      realRowIndex,
      columnIndex,
    };
  }, [activeCell, real2RowIndex]);
  const cellContent = useMemo(() => {
    return getCellContent([columnIndex, realRowIndex]) as IInnerCell;
  }, [columnIndex, realRowIndex, getCellContent]);
  const { type: cellType, readonly, editorWidth } = cellContent;
  const editingEnable = !readonly && isEditing && activeCell;
  const width = editorWidth ?? coordInstance.getColumnWidth(columnIndex);
  const height = activeCellBound?.height ?? coordInstance.getRowHeight(rowIndex);
  const editorRef = useRef<IEditorRef | null>(null);
  const defaultFocusRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    saveValue: () => editorRef.current?.saveValue?.(),
  }));

  useEffect(() => {
    if ((cellContent as ICell).type === CellType.Loading) return;
    if (!activeCell || isEditing) return;
    editorRef.current?.setValue?.(cellContent.data);
  }, [cellContent, activeCell, isEditing]);

  useEffect(() => {
    if ((cellType as CellType) === CellType.Loading) return;
    if (!activeCell || selection.type === SelectionRegionType.None) return;
    requestAnimationFrame(() => (editorRef.current || defaultFocusRef.current)?.focus?.());
  }, [cellType, activeCell, selection, isEditing]);

  useKeyboardSelection({
    editorRef,
    isEditing,
    activeCell,
    selection,
    coordInstance,
    onUndo,
    onRedo,
    onDelete,
    onRowExpand,
    setEditing,
    setActiveCell,
    setSelection,
    scrollToItem,
  });

  const editorStyle = useMemo(
    () =>
      (editingEnable
        ? { pointerEvents: 'auto', minWidth: width, minHeight: height }
        : { pointerEvents: 'none', opacity: 0, width: 0, height: 0 }) as React.CSSProperties,
    [editingEnable, height, width]
  );

  const rect = useMemo(() => {
    const { rowInitSize, columnInitSize, containerWidth, containerHeight } = coordInstance;
    const x = clamp(
      coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft),
      columnInitSize,
      containerWidth - width - cellEditorEdgePadding
    );
    const y = clamp(
      coordInstance.getRowOffset(rowIndex) - scrollTop,
      rowInitSize,
      containerHeight - height
    );

    return {
      x,
      y,
      width,
      height,
    };
  }, [coordInstance, rowIndex, columnIndex, width, height, scrollLeft, scrollTop]);

  const EditorRenderer = useMemo(() => {
    if (readonly) return null;

    const onChangeInner = (value: unknown) => {
      onChange?.([columnIndex, realRowIndex], {
        ...cellContent,
        data: value,
      } as IInnerCell);
    };

    const { customEditor } = cellContent;

    if (customEditor) {
      return customEditor(
        {
          rect,
          theme,
          style: editorStyle,
          cell: cellContent as IInnerCell,
          isEditing,
          setEditing,
          onChange: onChangeInner,
        },
        editorRef
      );
    }

    switch (cellType) {
      case CellType.Text:
      case CellType.Link:
      case CellType.Number: {
        return (
          <TextEditor
            ref={editorRef}
            rect={rect}
            theme={theme}
            style={editorStyle}
            cell={cellContent}
            isEditing={isEditing}
            onChange={onChangeInner}
          />
        );
      }
      case CellType.Boolean:
        return (
          <BooleanEditor
            ref={editorRef}
            rect={rect}
            theme={theme}
            cell={cellContent}
            onChange={onChangeInner}
          />
        );
      case CellType.Rating:
        return (
          <RatingEditor
            ref={editorRef}
            rect={rect}
            theme={theme}
            cell={cellContent}
            onChange={onChangeInner}
          />
        );
      case CellType.Select:
        return (
          <SelectEditor
            ref={editorRef}
            rect={rect}
            theme={theme}
            cell={cellContent}
            style={editorStyle}
            isEditing={isEditing}
            setEditing={setEditing}
            onChange={onChangeInner}
          />
        );
      default:
        return null;
    }
  }, [
    rect,
    theme,
    readonly,
    cellType,
    cellContent,
    columnIndex,
    realRowIndex,
    editorStyle,
    isEditing,
    onChange,
    setEditing,
  ]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeCell || isEditing) return;
    if (!isPrintableKey(event.nativeEvent)) return;
    if (NO_EDITING_CELL_TYPES.has(cellType)) return;
    setEditing(true);
    editorRef.current?.setValue?.(null);
  };

  const onPasteInner = (e: React.ClipboardEvent) => {
    if (!activeCell || isEditing) return;
    onPaste?.(selection, e);
  };

  const onCopyInner = (e: React.ClipboardEvent) => {
    if (!activeCell || isEditing) return;
    onCopy?.(selection, e);
  };

  return (
    <div className="click-outside-ignore pointer-events-none absolute left-0 top-0 w-full">
      <div
        className="absolute z-10"
        style={{
          top: rect.y,
          left: rect.x,
          minWidth: width,
          minHeight: height,
        }}
        onKeyDown={onKeyDown}
        onPaste={onPasteInner}
        onCopy={onCopyInner}
      >
        {EditorRenderer}
        <input className="opacity-0" ref={defaultFocusRef} />
      </div>
    </div>
  );
};

export const EditorContainer = forwardRef(EditorContainerBase);
