import type {
  ISelectFieldOptions,
  ISingleSelectCellValue,
  IMultipleSelectCellValue,
} from '@teable/core';
import { FieldType } from '@teable/core';
import { temporaryPaste } from '@teable/openapi';
import { useTheme } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { useTableId, useTablePermission } from '../../../hooks';
import type { MultipleSelectField, SingleSelectField } from '../../../model';
import { ensureSelectChoice, getSelectColorPairs } from '../../../utils';
import { SelectEditorMain } from '../../editor';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

interface IPendingCellSaves {
  count: number;
  sent: unknown[];
  heldBack: boolean;
  failed: boolean;
}

const GridSelectEditorBase: ForwardRefRenderFunction<
  IEditorRef<string | string[] | undefined>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { field, record, rect, style, isEditing, initialSearch, setEditing } = props;
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const tableId = useTableId();
  const permission = useTablePermission();
  // Creating a new option modifies the field's schema (choices list), so it
  // requires field|update — record|update alone (e.g. share-edit) is not
  // enough. We fold this into preventAutoNewOptions so the editor's existing
  // "no new options" semantics carry the gate (instead of conditionally
  // swallowing the callback).
  const canAddOption = Boolean(permission['field|update']);
  const defaultFocusRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<IEditorRef<string | string[] | undefined>>(null);
  const {
    id: fieldId,
    type: fieldType,
    options,
    displayChoiceMap,
  } = field as SingleSelectField | MultipleSelectField;
  const isMultiple = fieldType === FieldType.MultipleSelect;
  const cellValue = record.getCellValue(field.id) as
    | ISingleSelectCellValue
    | IMultipleSelectCellValue;
  const attachStyle = useGridPopupPosition(rect, 340);
  // The grid reuses this editor across cells, so saves in flight are tracked per cell: the
  // count, the values sent, and whether a cell update was held back while they were pending.
  const pendingSavesRef = useRef(new Map<string, IPendingCellSaves>());
  const cellKey = `${record.id}:${fieldId}`;
  const cellKeyRef = useRef(cellKey);
  cellKeyRef.current = cellKey;
  const shownCellKeyRef = useRef(cellKey);
  const cellValueRef = useRef(cellValue);
  cellValueRef.current = cellValue;

  useEffect(() => {
    if (!isMultiple) return;
    const cellChanged = shownCellKeyRef.current !== cellKey;
    shownCellKeyRef.current = cellKey;
    // While this cell's saves are in flight, the server's echo of an earlier click would undo a
    // later one, so the editor keeps its local value until they settle. Moving to another cell
    // always shows that cell's value.
    const pending = pendingSavesRef.current.get(cellKey);
    if (pending && !cellChanged) {
      pending.heldBack = true;
      return;
    }
    editorRef.current?.setValue?.(cellValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellKey, JSON.stringify(cellValue)]);

  useImperativeHandle(ref, () => ({
    focus: () => (editorRef.current || defaultFocusRef.current)?.focus?.(),
    setValue: (value?: string | string[]) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  const selectOptions = useMemo(() => {
    const choices = (options as ISelectFieldOptions)?.choices || [];
    return choices.map(({ name, color }) => ({
      label: name,
      value: name,
      sourceColor: color,
      ...(resolvedTheme === 'dark'
        ? getSelectColorPairs(color, resolvedTheme)
        : (displayChoiceMap[name] ?? getSelectColorPairs(color, resolvedTheme))),
    }));
  }, [options, displayChoiceMap, resolvedTheme]);

  const onChange = async (value?: string[] | string) => {
    const nextValue = isMultiple && value?.length === 0 ? null : value;
    const save = record.updateCell(fieldId, nextValue, { t });
    if (!isMultiple) {
      setTimeout(() => setEditing?.(false));
      return;
    }
    const key = cellKey;
    const pending = pendingSavesRef.current.get(key) ?? {
      count: 0,
      sent: [],
      heldBack: false,
      failed: false,
    };
    pendingSavesRef.current.set(key, pending);
    pending.count += 1;
    pending.sent.push(nextValue ?? null);
    // updateCell resolves with the error after rolling the cell back.
    if (await save) pending.failed = true;
    pending.count -= 1;
    if (pending.count) return;
    pendingSavesRef.current.delete(key);
    if (cellKeyRef.current !== key) return;
    const latest = cellValueRef.current ?? null;
    const missedUpdate = pending.heldBack && !pending.sent.some((sent) => isEqual(sent, latest));
    if (pending.failed || missedUpdate) editorRef.current?.setValue?.(cellValueRef.current);
  };

  const onOptionAdd = useCallback(
    async (name: string) => {
      if (!tableId) return;

      await temporaryPaste(tableId, {
        content: name,
        projection: [fieldId],
        ranges: [
          [0, 0],
          [0, 0],
        ],
      });

      // temporaryPaste typecast creates the choice server-side, but the response
      // does not include updated field options. Append locally so the immediate
      // updateCell/render path can validate the new name before ShareDB catches up.
      ensureSelectChoice(options as ISelectFieldOptions, name);
    },
    [tableId, fieldId, options]
  );

  return (
    <>
      {isEditing ? (
        <SelectEditorMain
          ref={editorRef}
          style={{
            ...style,
            ...attachStyle,
            height: 'auto',
          }}
          className="absolute rounded-sm border p-2 shadow-sm"
          value={cellValue === null ? undefined : cellValue}
          isMultiple={isMultiple}
          preventAutoNewOptions={
            (options as ISelectFieldOptions)?.preventAutoNewOptions || !canAddOption
          }
          options={selectOptions}
          initialSearch={initialSearch}
          onChange={onChange}
          onOptionAdd={onOptionAdd}
        />
      ) : (
        <input className="size-0 opacity-0" ref={defaultFocusRef} />
      )}
    </>
  );
};

export const GridSelectEditor = forwardRef(GridSelectEditorBase);
