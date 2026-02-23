/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import type { ILinkCellValue } from '@teable/core';
import type { FC } from 'react';
import { useMemo, useRef, useState } from 'react';
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
const POPOVER_MIN_WIDTH = 320;
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

  const attachStyle = useGridPopupPosition(rect, POPOVER_HEIGHT);

  // Calculate horizontal position and width to avoid overflow
  const popupLayout = useMemo(() => {
    const { editorId } = rect;
    const editorElement = document.querySelector('#' + editorId);
    const gridElement = editorElement?.closest(`[${GRID_CONTAINER_ATTR}]`);
    const gridBound = gridElement?.getBoundingClientRect();

    if (gridBound == null) {
      return {
        marginLeft: 0,
        width: POPOVER_WIDTH,
      };
    }

    const anchorLeft = gridBound.left + rect.x;
    const visibleLeft = gridBound.left + SAFE_SPACING;
    const visibleRight = gridBound.right - SAFE_SPACING;
    const maxWidth = Math.max(0, visibleRight - visibleLeft);
    const width =
      maxWidth >= POPOVER_MIN_WIDTH
        ? Math.max(POPOVER_MIN_WIDTH, Math.min(POPOVER_WIDTH, maxWidth))
        : Math.max(1, Math.min(maxWidth, POPOVER_WIDTH));

    let left = anchorLeft;
    if (left + width > visibleRight) {
      left = visibleRight - width;
    }
    if (left < visibleLeft) {
      left = visibleLeft;
    }

    return {
      marginLeft: left - anchorLeft,
      width,
    };
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
        width: popupLayout.width,
        marginLeft: popupLayout.marginLeft,
      }}
      className="absolute flex flex-col gap-2 rounded-md border bg-popover p-4 shadow-md"
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
