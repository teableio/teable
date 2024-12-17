import { useHotkeys, isHotkeyPressed } from 'react-hotkeys-hook';
import type { IEditorContainerProps, IEditorRef } from '../components';
import { SelectionRegionType } from '../interface';
import type { IRange } from '../interface';

interface ISelectionKeyboardProps
  extends Omit<
    IEditorContainerProps,
    | 'theme'
    | 'onChange'
    | 'scrollState'
    | 'activeCellBound'
    | 'real2RowIndex'
    | 'getCellContent'
    | 'onCellActivated'
  > {
  editorRef: React.MutableRefObject<IEditorRef | null>;
}

export const useKeyboardSelection = (props: ISelectionKeyboardProps) => {
  const {
    isEditing,
    activeCell,
    coordInstance,
    selection,
    scrollToItem,
    setEditing,
    setActiveCell,
    setSelection,
    onUndo,
    onRedo,
    onDelete,
    onRowExpand,
    editorRef,
    scrollBy,
  } = props;
  const { pureRowCount, columnCount } = coordInstance;

  useHotkeys(
    'mod+z',
    () => {
      onUndo?.();
    },
    {
      enabled: !isEditing && selection.type !== SelectionRegionType.None,
      preventDefault: true,
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    ['mod+shift+z', 'mod+y'],
    () => {
      onRedo?.();
    },
    {
      enabled: !isEditing && selection.type !== SelectionRegionType.None,
      preventDefault: true,
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    [
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
    ],
    (keyboardEvent, hotkeysEvent) => {
      const { shift, mod } = hotkeysEvent;
      const isMod = Boolean(mod);
      const isSelectionExpand = Boolean(shift);
      let [columnIndex, rowIndex] = selection.ranges[isSelectionExpand ? 1 : 0];

      if (isMod) {
        if (isHotkeyPressed('up')) {
          rowIndex = 0;
        } else if (isHotkeyPressed('down')) {
          rowIndex = pureRowCount - 1;
        } else if (isHotkeyPressed('left')) {
          columnIndex = 0;
        } else if (isHotkeyPressed('right')) {
          columnIndex = columnCount - 1;
        }
      } else {
        if (isHotkeyPressed('up')) {
          rowIndex = Math.max(rowIndex - 1, 0);
        } else if (isHotkeyPressed('down')) {
          rowIndex = Math.min(rowIndex + 1, pureRowCount - 1);
        } else if (isHotkeyPressed('left')) {
          columnIndex = Math.max(columnIndex - 1, 0);
        } else if (isHotkeyPressed('right')) {
          columnIndex = Math.min(columnIndex + 1, columnCount - 1);
        }
      }

      const newRange = <IRange>[columnIndex, rowIndex];
      const ranges = isSelectionExpand ? [selection.ranges[0], newRange] : [newRange, newRange];

      scrollToItem([columnIndex, rowIndex]);
      !isSelectionExpand && setActiveCell(newRange);
      setSelection(selection.setRanges(ranges));
    },
    {
      enabled: Boolean(activeCell && !isEditing),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    ['tab', 'shift+tab'],
    () => {
      const [columnIndex, rowIndex] = selection.ranges[0];

      let newColumnIndex = Math.min(columnIndex + 1, columnCount - 1);
      if (isHotkeyPressed('shift') && isHotkeyPressed('tab'))
        newColumnIndex = Math.max(columnIndex - 1, 0);

      const newRange = <IRange>[newColumnIndex, rowIndex];
      const ranges = [newRange, newRange];

      editorRef.current?.saveValue?.();
      scrollToItem([newColumnIndex, rowIndex]);
      setEditing(false);
      setActiveCell(newRange);
      setSelection(selection.setRanges(ranges));
    },
    {
      enabled: Boolean(activeCell),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    ['PageUp', 'PageDown'],
    () => {
      const delta = coordInstance.containerHeight - coordInstance.rowInitSize - 1;
      scrollBy(0, isHotkeyPressed('PageUp') ? -delta : delta);
    },
    {
      enabled: Boolean(activeCell && !isEditing),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );
  useHotkeys(
    'mod+a',
    () => {
      const ranges = [
        [0, 0],
        [columnCount - 1, pureRowCount - 1],
      ] as IRange[];
      setSelection(selection.setRanges(ranges));
    },
    {
      enabled: Boolean(activeCell && !isEditing),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    ['del', 'backspace', 'f2'],
    () => {
      if (isHotkeyPressed('f2')) {
        return setEditing(true);
      }
      if (isHotkeyPressed('backspace') || isHotkeyPressed('del')) {
        return onDelete?.(selection);
      }
    },
    {
      enabled: Boolean(activeCell && !isEditing),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    ['enter'],
    (keyboardEvent) => {
      if (keyboardEvent.isComposing) return;

      const { isColumnSelection, ranges: selectionRanges } = selection;
      if (isEditing) {
        let range = selectionRanges[0];
        if (isColumnSelection) {
          range = [range[0], 0];
        }
        const [columnIndex, rowIndex] = range;
        const nextRowIndex = Math.min(rowIndex + 1, pureRowCount - 1);
        const newRange = [columnIndex, nextRowIndex] as IRange;
        editorRef.current?.saveValue?.();
        setTimeout(() => {
          setSelection(selection.set(SelectionRegionType.Cells, [newRange, newRange]));
          setActiveCell(newRange);
          setEditing(false);
          scrollToItem(newRange as IRange);
        });
      } else {
        setEditing(true);
      }
    },
    {
      enabled: Boolean(activeCell),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    'esc',
    () => {
      setEditing(false);
    },
    {
      enabled: Boolean(activeCell),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  useHotkeys(
    'space',
    () => {
      const [, rowIndex] = activeCell!;
      onRowExpand?.(rowIndex);
    },
    {
      enabled: Boolean(activeCell && !isEditing),
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );
};
