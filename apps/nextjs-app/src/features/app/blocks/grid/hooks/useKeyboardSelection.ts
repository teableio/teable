import Mousetrap from 'mousetrap';
import type { ExtendedKeyboardEvent } from 'mousetrap';
import { useEffect } from 'react';
import { SelectionRegionType, type IInnerCell, type IRange } from '..';
import type { IEditorContainerProps, IEditorRef } from '../components';
import { GRID_DEFAULT } from '../configs';
import { getCellRenderer } from '../renderers';

// eslint-disable-next-line @typescript-eslint/naming-convention
const SELECTION_MOVE_HOTKEYS = [
  'up',
  'down',
  'left',
  'right',
  'mod+up',
  'mod+down',
  'mod+left',
  'mod+right',
  'shift+up',
  'shift+down',
  'shift+left',
  'shift+right',
  'mod+shift+up',
  'mod+shift+down',
  'mod+shift+left',
  'mod+shift+right',
  'tab',
];

interface ISelectionKeyboardProps
  extends Omit<IEditorContainerProps, 'theme' | 'onChange' | 'getCellContent'> {
  cell: IInnerCell;
  editorRef: React.MutableRefObject<IEditorRef | null>;
}

const { cellScrollBuffer } = GRID_DEFAULT;

export const useKeyboardSelection = (props: ISelectionKeyboardProps) => {
  const {
    cell,
    isEditing,
    activeCell,
    scrollState,
    coordInstance,
    selection,
    scrollTo,
    setEditing,
    setActiveCell,
    setSelection,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    editorRef,
  } = props;
  const { scrollLeft, scrollTop } = scrollState;
  const {
    pureRowCount,
    columnCount,
    freezeRegionWidth,
    freezeColumnCount,
    containerWidth,
    containerHeight,
    rowInitSize,
  } = coordInstance;

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const scrollToCell = (position: [columnIndex: number, rowIndex: number]) => {
    const [columnIndex, rowIndex] = position;
    const isFreezeColumn = columnIndex < freezeColumnCount;

    if (!isFreezeColumn) {
      const offsetX = coordInstance.getColumnOffset(columnIndex);
      const columnWidth = coordInstance.getColumnWidth(columnIndex);
      const deltaLeft = Math.min(offsetX - scrollLeft - freezeRegionWidth, 0);
      const deltaRight = Math.max(offsetX + columnWidth - scrollLeft - containerWidth, 0);
      const sl = scrollLeft + deltaLeft + deltaRight;
      if (sl !== scrollLeft) {
        const scrollBuffer =
          deltaLeft < 0 ? -cellScrollBuffer : deltaRight > 0 ? cellScrollBuffer : 0;
        scrollTo(sl + scrollBuffer, undefined);
      }
    }

    const rowHeight = coordInstance.getRowHeight(rowIndex);
    const offsetY = coordInstance.getRowOffset(rowIndex);
    const deltaTop = Math.min(offsetY - scrollTop - rowInitSize, 0);
    const deltaBottom = Math.max(offsetY + rowHeight - scrollTop - containerHeight, 0);
    const st = scrollTop + deltaTop + deltaBottom;
    if (st !== scrollTop) {
      scrollTo(undefined, st);
    }
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  useEffect(() => {
    const mousetrap = new Mousetrap();
    mousetrap.stopCallback = () => {
      return false;
    };

    mousetrap.bind(SELECTION_MOVE_HOTKEYS, (e: ExtendedKeyboardEvent, combo: string) => {
      if (!activeCell || isEditing) return;
      e.preventDefault();
      const isSelectionExpand = combo.includes('shift');
      let [columnIndex, rowIndex] = selection.ranges[isSelectionExpand ? 1 : 0];

      switch (combo) {
        case 'up':
        case 'shift+up':
          rowIndex = Math.max(rowIndex - 1, 0);
          break;
        case 'down':
        case 'shift+down':
          rowIndex = Math.min(rowIndex + 1, pureRowCount - 1);
          break;
        case 'left':
        case 'shift+left':
          columnIndex = Math.max(columnIndex - 1, 0);
          break;
        case 'tab':
        case 'right':
        case 'shift+right':
          columnIndex = Math.min(columnIndex + 1, columnCount - 1);
          break;
        case 'mod+up':
        case 'mod+shift+up':
          rowIndex = 0;
          break;
        case 'mod+down':
        case 'mod+shift+down':
          rowIndex = pureRowCount - 1;
          break;
        case 'mod+left':
        case 'mod+shift+left':
          columnIndex = 0;
          break;
        case 'mod+right':
        case 'mod+shift+right':
          columnIndex = columnCount - 1;
          break;
      }

      const newRange = <IRange>[columnIndex, rowIndex];
      const ranges = isSelectionExpand ? [selection.ranges[0], newRange] : [newRange, newRange];

      scrollToCell([columnIndex, rowIndex]);
      !isSelectionExpand && setActiveCell(newRange);
      setSelection(selection.setRanges(ranges));
    });

    mousetrap.bind('mod+a', (e: ExtendedKeyboardEvent) => {
      if (!activeCell || isEditing) return;
      e.preventDefault();
      const ranges = [
        [0, 0],
        [columnCount - 1, pureRowCount - 1],
      ] as IRange[];
      setSelection(selection.setRanges(ranges));
    });

    mousetrap.bind(
      ['del', 'backspace', 'mod+c', 'mod+v'],
      (e: ExtendedKeyboardEvent, combo: string) => {
        if (!activeCell || isEditing) return;
        switch (combo) {
          case 'del':
          case 'backspace':
            return onDelete?.(selection);
          case 'mod+c':
            return onCopy?.(selection);
          case 'mod+v':
            return onPaste?.(selection);
        }
      }
    );

    mousetrap.bind('enter', () => {
      if (!activeCell) return;
      const { isColumnSelection, ranges: selectionRanges } = selection;
      const cellRenderer = getCellRenderer(cell.type);
      if (cellRenderer.onClick) return;
      if (isEditing) {
        let range = selectionRanges[0];
        if (isColumnSelection) {
          range = [range[0], 0];
        }
        const [columnIndex, rowIndex] = range;
        const nextRowIndex = rowIndex + 1;
        const newRange = [columnIndex, nextRowIndex] as IRange;
        editorRef.current?.saveValue?.();
        nextRowIndex > pureRowCount - 1 && onRowAppend?.();
        setTimeout(() => {
          if (isColumnSelection) {
            setSelection(selection.set(SelectionRegionType.Cells, [newRange, newRange]));
          } else {
            setSelection(selection.setRanges([newRange, newRange]));
          }
          setActiveCell(newRange);
          setEditing(false);
          scrollToCell(newRange as IRange);
        });
      } else {
        setEditing(true);
      }
    });

    mousetrap.bind('esc', () => {
      if (!activeCell) return;
      setEditing(false);
    });

    return () => {
      mousetrap.reset();
    };
  });
};
