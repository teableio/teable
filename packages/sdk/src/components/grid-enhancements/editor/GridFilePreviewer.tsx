import type { IAttachmentCellValue } from '@teable/core';
import type { IFilePreviewDialogRef } from '@teable/ui-lib';
import { FilePreviewDialog, FilePreviewProvider } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
// import { useTranslation } from '../../../context/app/i18n';
import type { IFieldInstance, Record as IRecord } from '../../../model';

interface IGridFilePreviewerProps {
  activeId: string;
  record: IRecord;
  field: IFieldInstance;
  i18nMap?: Record<string, string>;
}

export const GridFilePreviewer = (props: IGridFilePreviewerProps) => {
  const { activeId, record, field, i18nMap } = props;
  const attachments = record.getCellValue(field.id) as IAttachmentCellValue;
  const imagePreviewDialogRef = useRef<IFilePreviewDialogRef>(null);

  useEffect(() => {
    imagePreviewDialogRef.current?.openPreview?.(activeId);
  }, [activeId]);

  const previewFiles = useMemo(() => {
    return attachments
      ? attachments.map((item) => ({
          src: item.presignedUrl || '',
          name: item.name,
          fileId: item.id,
          mimetype: item.mimetype,
        }))
      : [];
  }, [attachments]);

  return (
    <FilePreviewProvider i18nMap={i18nMap}>
      <FilePreviewDialog ref={imagePreviewDialogRef} files={previewFiles} />
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
