import type { IAttachmentCellValue } from '@teable/core';
import type { IFilePreviewDialogRef } from '@teable/ui-lib';
import { FilePreviewDialog, FilePreviewProvider } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
// import { useTranslation } from '../../../context/app/i18n';
import type { IFieldInstance, Record as IRecord } from '../../../model';

interface IGridFilePreviewerProps {
  activeId: string;
  record: IRecord;
  field: IFieldInstance;
  i18nMap?: Record<string, string>;
  /** Enables deleting from the preview. Omit when the cell is read-only. */
  onChange?: (attachments: IAttachmentCellValue | null) => void;
}

export const GridFilePreviewer = (props: IGridFilePreviewerProps) => {
  const { activeId, record, field, i18nMap, onChange } = props;
  // Rendered in a detached root that never re-renders on record updates, so
  // the list is kept locally and mirrored to the record through onChange.
  const [attachments, setAttachments] = useState(
    () => (record.getCellValue(field.id) ?? []) as IAttachmentCellValue
  );
  const imagePreviewDialogRef = useRef<IFilePreviewDialogRef>(null);

  useEffect(() => {
    imagePreviewDialogRef.current?.openPreview?.(activeId);
  }, [activeId]);

  const previewFiles = useMemo(() => {
    return attachments.map((item) => ({
      src: item.presignedUrl || '',
      thumb: item.lgThumbnailUrl,
      name: item.name,
      fileId: item.id,
      mimetype: item.mimetype,
    }));
  }, [attachments]);

  const onDelete = onChange
    ? (fileId: string | number) => {
        const rest = attachments.filter((item) => item.id !== fileId);
        setAttachments(rest);
        onChange(rest.length ? rest : null);
      }
    : undefined;

  return (
    <FilePreviewProvider i18nMap={i18nMap}>
      <FilePreviewDialog ref={imagePreviewDialogRef} files={previewFiles} onDelete={onDelete} />
    </FilePreviewProvider>
  );
};

let closeModalFn = noop;

export const closePreviewModal = () => {
  closeModalFn();
  closeModalFn = noop;
};

export const expandPreviewModal = (props: IGridFilePreviewerProps) => {
  closeModalFn();
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);

  const close = () => {
    root.unmount();
    if (div && div.parentNode) {
      div.parentNode.removeChild(div);
    }
  };
  closeModalFn = close;

  const render = (props: IGridFilePreviewerProps) => {
    root.render(<GridFilePreviewer {...props} />);
  };

  const update = (props: IGridFilePreviewerProps) => {
    render(props);

    return {
      update,
    };
  };

  render(props);

  return {
    update,
  };
};
