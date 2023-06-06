import { FieldType } from '@teable-group/core';
import { useField, useRecord } from '@teable-group/sdk';
import { useRef, useMemo } from 'react';
import { useClickAway } from 'react-use';
import { useViewStore } from '../../store/view';
import { useGridViewStore } from '../store/gridView';
import { AttachmentEditor } from './editor/AttachmentEditor';
import { SelectEditor } from './editor/SelectEditor';

export const EditorContainer = () => {
  const { editorCtx, clearEditorCtx } = useGridViewStore();
  const { activeCell } = useViewStore();
  const field = useField(activeCell?.fieldId);
  const ref = useRef<HTMLDivElement>(null);
  const record = useRecord(activeCell?.recordId);
  useClickAway(ref, () => {
    onCancel();
  });

  const onCancel = () => {
    clearEditorCtx();
  };

  const Editor = () => {
    if (!field || !record) {
      console.log('record', record);
      return <></>;
    }
    const style = editorCtx
      ? {
          minWidth: editorCtx.cell.width + 2,
          minHeight: editorCtx.cell.height + 2,
        }
      : {};
    switch (field.type) {
      case FieldType.SingleSelect:
      case FieldType.MultipleSelect:
        return <SelectEditor style={style} field={field} record={record} />;
      case FieldType.Attachment:
        return <AttachmentEditor style={style} field={field} record={record} onCancel={onCancel} />;
      default:
        return <></>;
    }
  };

  const style = useMemo(() => {
    if (!editorCtx) {
      return;
    }
    const { pos, cell } = editorCtx;
    return {
      top: pos.y + cell.height,
      left: pos.x - 1,
    };
  }, [editorCtx]);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={ref}
      className="absolute z-10"
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      style={style}
    >
      {Editor()}
    </div>
  );
};
