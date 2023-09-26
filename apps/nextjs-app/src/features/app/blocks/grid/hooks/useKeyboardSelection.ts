import Mousetrap from 'mousetrap';
import type { ExtendedKeyboardEvent } from 'mousetrap';
import { useEffect } from 'react';
import { SelectionRegionType, type IInnerCell, type IRange } from '..';
import type { IEditorContainerProps, IEditorRef } from '../components';
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
  extends Omit<IEditorContainerProps, 'theme' | 'onChange' | 'scrollState' | 'getCellContent'> {
  cell: IInnerCell;
  editorRef: React.MutableRefObject<IEditorRef | null>;
}

export const useKeyboardSelection = (props: ISelectionKeyboardProps) => {
  const {
    cell,
    isEditing,
    activeCell,
    coordInstance,
    selection,
    scrollToItem,
    setEditing,
    setActiveCell,
    setSelection,
    onCopy,
    onPaste,
    onDelete,
    onRowAppend,
    onRowExpand,
    editorRef,
  } = props;
  const { pureRowCount, columnCount } = coordInstance;

  // eslint-disable-next-line sonarjs/cognitive-complexity
  useEffect(() => {
    Mousetrap.prototype.stopCallback = () => {
      return false;
    };

    Mousetrap.bind(SELECTION_MOVE_HOTKEYS, (e: ExtendedKeyboardEvent, combo: string) => {
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

      scrollToItem([columnIndex, rowIndex]);
      !isSelectionExpand && setActiveCell(newRange);
      setSelection(selection.setRanges(ranges));
    });

    Mousetrap.bind('mod+a', (e: ExtendedKeyboardEvent) => {
      if (!activeCell || isEditing) return;
      e.preventDefault();
      const ranges = [
        [0, 0],
        [columnCount - 1, pureRowCount - 1],
      ] as IRange[];
      setSelection(selection.setRanges(ranges));
    });

    Mousetrap.bind(
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

    Mousetrap.bind(['enter', 'shift+enter'], (e: ExtendedKeyboardEvent, combo: string) => {
      if (!activeCell) return;
      const { isColumnSelection, ranges: selectionRanges } = selection;
      const cellRenderer = getCellRenderer(cell.type);
      const isShiftEnter = combo === 'shift+enter';
      if (cellRenderer.onClick) return;
      if (isEditing) {
        let range = selectionRanges[0];
        if (isColumnSelection) {
          range = [range[0], 0];
        }
        const [columnIndex, rowIndex] = range;
        const nextRowIndex = isShiftEnter ? rowIndex + 1 : Math.min(rowIndex + 1, pureRowCount - 1);
        const newRange = [columnIndex, nextRowIndex] as IRange;
        editorRef.current?.saveValue?.();
        isShiftEnter && onRowAppend?.();
        setTimeout(() => {
          if (isColumnSelection) {
            setSelection(selection.set(SelectionRegionType.Cells, [newRange, newRange]));
          } else {
            setSelection(selection.setRanges([newRange, newRange]));
          }
          setActiveCell(newRange);
          setEditing(false);
          scrollToItem(newRange as IRange);
        });
      } else {
        setEditing(true);
      }
    });

    Mousetrap.bind('esc', () => {
      if (!activeCell) return;
      setEditing(false);
    });

    Mousetrap.bind('space', () => {
      if (!activeCell) return;
      const [, rowIndex] = activeCell;
      onRowExpand?.(rowIndex);
    });

    return () => {
      Mousetrap.reset();
    };
  });
};
