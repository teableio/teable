import type { IAttachmentCellValue } from '@teable/core';
import type { IFilePreviewDialogRef } from '@teable/ui-lib';
import { FilePreviewDialog, FilePreviewProvider } from '@teable/ui-lib';
import { noop } from 'lodash';
import { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { IFieldInstance, Record } from '../../../model';

interface IGridFilePreviewerProps {
  activeId: string;
  record: Record;
  field: IFieldInstance;
}

export const GridFilePreviewer = (props: IGridFilePreviewerProps) => {
  const { activeId, record, field } = props;
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
    <FilePreviewProvider>
      <FilePreviewDialog ref={imagePreviewDialogRef} files={previewFiles} />
    </FilePreviewProvider>
  );
};

let preCloseModalFn = noop;

export const expandPreviewModalClose = () => {
  preCloseModalFn();
  preCloseModalFn = noop;
};

export const expandPreviewModal = (props: IGridFilePreviewerProps) => {
  preCloseModalFn();
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const close = () => {
    root.unmount();
    if (div && div.parentNode) {
      div.parentNode.removeChild(div);
    }
  };
  preCloseModalFn = close;

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
