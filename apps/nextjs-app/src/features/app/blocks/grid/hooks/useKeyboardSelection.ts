import Mousetrap from 'mousetrap';
import type { ExtendedKeyboardEvent } from 'mousetrap';
import { useEffect } from 'react';
import type { IRange } from '..';
import type { IEditorContainerProps, IEditorRef } from '../components';

// eslint-disable-next-line @typescript-eslint/naming-convention
const SELECTION_HOTKEYS = [
  'up',
  'down',
  'left',
  'right',
  'command+up',
  'command+down',
  'command+left',
  'command+right',
  'shift+up',
  'shift+down',
  'shift+left',
  'shift+right',
  'command+shift+up',
  'command+shift+down',
  'command+shift+left',
  'command+shift+right',
  'tab',
];

interface ISelectionKeyboardProps
  extends Omit<IEditorContainerProps, 'theme' | 'onChange' | 'getCellContent'> {
  editorRef: React.MutableRefObject<IEditorRef | null>;
}

export const useKeyboardSelection = (props: ISelectionKeyboardProps) => {
  const {
    isEditing,
    activeCell,
    scrollState,
    coordInstance,
    selectionState,
    scrollTo,
    setEditing,
    setActiveCell,
    setSelectionState,
    onDelete,
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

  const scrollToCell = (position: [columnIndex: number, rowIndex: number]) => {
    const [columnIndex, rowIndex] = position;
    const isFreezeColumn = columnIndex < freezeColumnCount;
    const rowHeight = coordInstance.getRowHeight(rowIndex);

    if (!isFreezeColumn) {
      const offsetX = coordInstance.getColumnOffset(columnIndex);
      const columnWidth = coordInstance.getColumnWidth(columnIndex);
      const deltaLeft = Math.min(offsetX - scrollLeft - freezeRegionWidth, 0);
      const deltaRight = Math.max(offsetX + columnWidth - scrollLeft - containerWidth, 0);
      const sl = scrollLeft + deltaLeft + deltaRight;
      const spaceBuffer = deltaLeft < 0 ? -rowHeight : deltaRight > 0 ? rowHeight : 0;
      sl !== scrollLeft && scrollTo(sl + spaceBuffer, undefined);
    }

    const offsetY = coordInstance.getRowOffset(rowIndex);
    const deltaTop = Math.min(offsetY - scrollTop - rowInitSize, 0);
    const deltaBottom = Math.max(offsetY + rowHeight - scrollTop - containerHeight, 0);
    const st = scrollTop + deltaTop + deltaBottom;
    st !== scrollTop && scrollTo(undefined, st);
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  useEffect(() => {
    const mousetrap = new Mousetrap();
    mousetrap.stopCallback = () => {
      return false;
    };

    mousetrap.bind(SELECTION_HOTKEYS, (e: ExtendedKeyboardEvent, combo: string) => {
      if (!activeCell || isEditing) return;
      e.preventDefault();
      const isSelectionExpand = combo.includes('shift');
      let [columnIndex, rowIndex] = selectionState.ranges[isSelectionExpand ? 1 : 0];

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
        case 'command+up':
        case 'command+shift+up':
          rowIndex = 0;
          break;
        case 'command+down':
        case 'command+shift+down':
          rowIndex = pureRowCount - 1;
          break;
        case 'command+left':
        case 'command+shift+left':
          columnIndex = 0;
          break;
        case 'command+right':
        case 'command+shift+right':
          columnIndex = columnCount - 1;
          break;
      }

      const newRange = <IRange>[columnIndex, rowIndex];
      const ranges = isSelectionExpand
        ? [selectionState.ranges[0], newRange]
        : [newRange, newRange];

      scrollToCell([columnIndex, rowIndex]);
      !isSelectionExpand && setActiveCell(newRange);
      setSelectionState((prev) => ({ ...prev, ranges }));
    });

    mousetrap.bind('command+a', (e: ExtendedKeyboardEvent) => {
      if (!activeCell || isEditing) return;
      e.preventDefault();
      const ranges = [
        [0, 0],
        [columnCount - 1, pureRowCount - 1],
      ] as IRange[];
      setSelectionState((prev) => ({ ...prev, ranges }));
    });

    mousetrap.bind(['del', 'backspace'], () => {
      if (!activeCell || isEditing) return;
      onDelete?.(selectionState);
    });

    mousetrap.bind('enter', () => {
      if (!activeCell) return;
      const { ranges } = selectionState;
      if (isEditing) {
        editorRef.current?.saveValue?.();
        const [columnIndex, rowIndex] = ranges[0];
        const newRange = [columnIndex, Math.min(rowIndex + 1, pureRowCount - 1)] as IRange;
        setEditing(false);
        setActiveCell(newRange);
        setSelectionState({ ...selectionState, ranges: [newRange, newRange] });
        scrollToCell(newRange as IRange);
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
