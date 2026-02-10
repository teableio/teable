/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import type { ILinkCellValue } from '@teable/core';
import type { FC } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { type LinkField } from '../../../model';
import type { ILinkEditorMainRef } from '../../editor/link/EditorMain';
import { LinkEditorMain } from '../../editor/link/EditorMain';
import { ExpandRecorder, ExpandRecordModel } from '../../expand-record';
import type { IEditorProps } from '../../grid/components';
import { GRID_CONTAINER_ATTR } from '../../grid/configs';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

const POPOVER_HEIGHT = 520;
const POPOVER_WIDTH = 800;
const SAFE_SPACING = 16;

export const GridLinkEditor: FC<IEditorProps & IWrapperEditorProps> = (props) => {
  const { record, field, rect, style, isEditing, setEditing } = props;
  const { id: fieldId, options } = field as LinkField;
  const cellValue = record.getCellValue(fieldId) as ILinkCellValue | ILinkCellValue[] | undefined;
  const currentRecordTitle = record.title;

  const { t } = useTranslation();

  const containerRef = useRef<HTMLDivElement>(null);
  const linkEditorMainRef = useRef<ILinkEditorMainRef>(null);
  const [expandRecordId, setExpandRecordId] = useState<string>();
  const initialRectRef = useRef(rect);
  const editingSessionRef = useRef(false);

  useEffect(() => {
    if (isEditing && !editingSessionRef.current) {
      initialRectRef.current = rect;
      editingSessionRef.current = true;
    }
    if (!isEditing) {
      editingSessionRef.current = false;
    }
  }, [isEditing, rect]);

  const attachStyle = useGridPopupPosition(initialRectRef.current, POPOVER_HEIGHT);

  // Calculate horizontal position to avoid overflow
  const horizontalOffset = useMemo(() => {
    const { editorId } = rect;
    const editorElement = document.querySelector('#' + editorId);
    const gridElement = editorElement?.closest(`[${GRID_CONTAINER_ATTR}]`);
    const gridBound = gridElement?.getBoundingClientRect();

    if (gridBound == null) return 0;

    const gridRight = gridBound.right;
    const popoverRight = gridBound.left + rect.x + POPOVER_WIDTH;

    if (popoverRight > gridRight - SAFE_SPACING) {
      return gridRight - SAFE_SPACING - popoverRight;
    }
    return 0;
  }, [rect]);

  const onChange = (value: ILinkCellValue | ILinkCellValue[] | null) => {
    record.updateCell(fieldId, value, { t });
  };

  const onExpand = (recordId: string) => {
    setExpandRecordId(recordId);
  };

  const onExpandClose = () => {
    setExpandRecordId(undefined);
  };

  if (!isEditing) {
    return null;
  }

  const height = attachStyle?.maxHeight ?? POPOVER_HEIGHT;

  return (
    <div
      ref={containerRef}
      role="dialog"
      tabIndex={-1}
      style={{
        ...style,
        ...attachStyle,
        height,
        marginLeft: horizontalOffset,
      }}
      className="absolute flex w-[800px] flex-col gap-2 rounded-md border bg-popover p-4 shadow-md"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <LinkEditorMain
        ref={linkEditorMainRef}
        container={containerRef.current || undefined}
        recordId={record.id}
        fieldId={fieldId}
        cellValue={cellValue}
        options={options}
        isEditing={isEditing}
        onChange={onChange}
        setEditing={setEditing}
        onExpand={onExpand}
        currentRecordTitle={currentRecordTitle}
      />
      {expandRecordId && (
        <ExpandRecorder
          tableId={options.foreignTableId}
          recordId={expandRecordId}
          model={ExpandRecordModel.Modal}
          onClose={onExpandClose}
        />
      )}
    </div>
  );
};
