import { forwardRef, useImperativeHandle, useRef } from 'react';
import { usePendingUploadContext } from '../../../../context/pending-upload';
import { useBaseId } from '../../../../hooks';
import {
  useLocalAttachmentUpload,
  useCellAttachmentUpload,
  usePendingAttachmentUpload,
} from './hooks';
import type {
  IUploadAttachment,
  IUploadAttachmentRef,
  UploadAttachmentCellProps,
  UploadAttachmentLocalProps,
  UploadAttachmentViewRef,
} from './types';
import { UploadAttachmentView } from './UploadAttachmentView';
import { AttachmentManager } from './uploadManage';

export type { IUploadAttachment, IUploadAttachmentRef, IUploadingFile } from './types';
export type { UploadAttachmentMode } from './types';

const cellAttachmentUpload = new AttachmentManager(4);
const defaultAttachmentManager = new AttachmentManager(2);

export const UploadAttachment = forwardRef<IUploadAttachmentRef, IUploadAttachment>(
  (props, ref) => {
    if (props.mode === 'local') {
      return <LocalUploadAttachment {...props} ref={ref} />;
    }
    return <CellUploadAttachment {...props} ref={ref} />;
  }
);

const LocalUploadAttachment = forwardRef<IUploadAttachmentRef, UploadAttachmentLocalProps>(
  (props, ref) => {
    const pendingCtx = usePendingUploadContext();

    // When inside a PendingUploadContext, delegate to PendingUploadAttachment
    if (pendingCtx) {
      return <PendingUploadAttachment {...props} pendingCtx={pendingCtx} ref={ref} />;
    }

    return <PureLocalUploadAttachment {...props} ref={ref} />;
  }
);

LocalUploadAttachment.displayName = 'LocalUploadAttachment';

const PureLocalUploadAttachment = forwardRef<IUploadAttachmentRef, UploadAttachmentLocalProps>(
  (props, ref) => {
    const { attachments, onChange, attachmentManager = defaultAttachmentManager } = props;
    const baseId = useBaseId();

    const { uploadingFiles, onUpload, onCancelUpload, setUploadingFiles } =
      useLocalAttachmentUpload({
        attachments,
        onChange,
        attachmentManager,
        baseId,
      });

    const viewRef = useRef<UploadAttachmentViewRef>(null);

    useImperativeHandle(ref, () => ({
      uploadAttachment: (files) => {
        onUpload(files);
        viewRef.current?.scrollToBottom();
      },
      setUploadingFiles,
    }));

    return (
      <UploadAttachmentView
        ref={viewRef}
        {...props}
        uploadingFiles={uploadingFiles}
        onUpload={onUpload}
        onCancelUpload={onCancelUpload}
      />
    );
  }
);

PureLocalUploadAttachment.displayName = 'PureLocalUploadAttachment';

interface IPendingUploadAttachmentProps extends UploadAttachmentLocalProps {
  pendingCtx: { tempRecordId: string; tableId: string };
}

const PendingUploadAttachment = forwardRef<IUploadAttachmentRef, IPendingUploadAttachmentProps>(
  (props, ref) => {
    const { pendingCtx, fieldId, ...localProps } = props;
    const baseId = useBaseId();

    const { uploadingFiles, onUpload, onCancelUpload } = usePendingAttachmentUpload({
      tableId: pendingCtx.tableId,
      tempRecordId: pendingCtx.tempRecordId,
      fieldId: fieldId ?? '',
      baseId,
      attachments: localProps.attachments,
      onChange: localProps.onChange,
    });

    const viewRef = useRef<UploadAttachmentViewRef>(null);

    useImperativeHandle(ref, () => ({
      uploadAttachment: (files) => {
        onUpload(files);
        viewRef.current?.scrollToBottom();
      },
      setUploadingFiles: () => {
        // no-op: pending uploads are managed by the global store
      },
    }));

    return (
      <UploadAttachmentView
        ref={viewRef}
        {...localProps}
        uploadingFiles={uploadingFiles}
        onUpload={onUpload}
        onCancelUpload={onCancelUpload}
      />
    );
  }
);

PendingUploadAttachment.displayName = 'PendingUploadAttachment';

const CellUploadAttachment = forwardRef<IUploadAttachmentRef, UploadAttachmentCellProps>(
  (props, ref) => {
    const { attachments, onChange } = props;
    const baseId = useBaseId();

    const localUpload = useLocalAttachmentUpload({
      attachments,
      onChange,
      attachmentManager: cellAttachmentUpload,
      baseId,
    });

    const cellUpload = useCellAttachmentUpload({
      tableId: props.tableId,
      recordId: props.recordId,
      fieldId: props.fieldId,
      baseId,
      enabled: true,
    });

    const uploadingFiles = cellUpload.uploadingFiles;

    const viewRef = useRef<UploadAttachmentViewRef>(null);

    useImperativeHandle(ref, () => ({
      uploadAttachment: (files) => {
        cellUpload.onUpload(files);
        viewRef.current?.scrollToBottom();
      },
      setUploadingFiles: localUpload.setUploadingFiles,
    }));
    return (
      <UploadAttachmentView
        {...props}
        uploadingFiles={uploadingFiles}
        onUpload={cellUpload.onUpload}
        onCancelUpload={cellUpload.onCancelUpload}
      />
    );
  }
);
CellUploadAttachment.displayName = 'CellUploadAttachment';

UploadAttachment.displayName = 'UploadAttachment';

export default UploadAttachment;
