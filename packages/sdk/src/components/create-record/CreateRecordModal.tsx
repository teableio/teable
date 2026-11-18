import { useMutation } from '@tanstack/react-query';
import { FieldKeyType, generateAttachmentId } from '@teable/core';
import { X } from '@teable/icons';
import { createRecords } from '@teable/openapi';
import { Dialog, DialogTrigger, DialogContent, Spin, Button } from '@teable/ui-lib';
import { isEqual, keyBy } from 'lodash';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useCounter } from 'react-use';
import { useTranslation } from '../../context/app/i18n';
import { PendingUploadContext } from '../../context/pending-upload';
import {
  useBaseId,
  useFields,
  useIsMobile,
  useSession,
  useTableId,
  useView,
  useViewId,
} from '../../hooks';
import type { IFieldInstance, Record as IRecord } from '../../model';
import { createRecordInstance, recordInstanceFieldMap } from '../../model';
import {
  finalizePendingUploadAfterCreate,
  mergePendingAttachmentsForCreate,
} from '../../store/pending-upload-create';
import { useCellAttachmentUploadStore } from '../../store/use-attachment-upload-store';
import { extractDefaultFieldsFromFilters } from '../../utils/filterWithDefaultValue';
import { Panel } from '../expand-record/Panel';
import { ExpandRecordPanelHostContext } from '../expand-record/PanelContext';
import { RecordEditor } from '../expand-record/RecordEditor';

interface ICreateRecordModalProps {
  children?: React.ReactNode;
  initialFields?: Record<string, unknown>;
  callback?: (recordId: string) => void;
}

export const CreateRecordModal = (props: ICreateRecordModalProps) => {
  const { children, callback, initialFields } = props;
  const tableId = useTableId();
  const baseId = useBaseId();
  const viewId = useViewId();
  const view = useView();
  const showFields = useFields();
  const [open, setOpen] = useState(false);
  // bumped on every click of the trigger: an open draft covered by a record comes back on top
  const [raiseKey, setRaiseKey] = useState(0);
  const [version, updateVersion] = useCounter(0);
  const { t } = useTranslation();
  const { inHost } = useContext(ExpandRecordPanelHostContext);
  const isMobile = useIsMobile();
  const allFields = useFields({ withHidden: true });
  const { user } = useSession();
  const [record, setRecord] = useState<IRecord | undefined>(undefined);
  const filter = view?.filter;
  const userId = user.id;

  // Pending upload support
  const [pendingRecordId, setPendingRecordId] = useState(() => generateAttachmentId());
  const consumePendingForCreate = useCellAttachmentUploadStore((s) => s.consumePendingForCreate);
  const promoteToCell = useCellAttachmentUploadStore((s) => s.promoteToCell);
  const cancelPendingUploads = useCellAttachmentUploadStore((s) => s.cancelPendingUploads);

  // Reset tempRecordId when dialog opens
  useEffect(() => {
    if (open) {
      setPendingRecordId(generateAttachmentId());
    }
  }, [open]);

  const pendingUploadCtx = useMemo(
    () => ({ tempRecordId: pendingRecordId, tableId: tableId! }),
    [pendingRecordId, tableId]
  );

  const { mutate: createRecord, isPending } = useMutation({
    mutationFn: async (fields: { [fieldId: string]: unknown }) => {
      const { mergedFields, consumedTaskIdsByCellKey } = mergePendingAttachmentsForCreate({
        fields,
        tableId: tableId ?? undefined,
        tempRecordId: pendingRecordId,
        consumePendingForCreate,
      });

      const result = await createRecords(tableId!, {
        records: [{ fields: mergedFields }],
        fieldKeyType: FieldKeyType.Id,
      });

      finalizePendingUploadAfterCreate({
        tableId: tableId ?? undefined,
        tempRecordId: pendingRecordId,
        realRecordId: result.data.records[0]?.id,
        consumedTaskIdsByCellKey,
        promoteToCell,
      });

      return result;
    },
    onSuccess: (data) => {
      setOpen(false);
      callback?.(data.data.records[0].id);
    },
  });

  const newRecord = useCallback(
    (version: number = 0, initData: { [fieldId: string]: unknown } = {}) => {
      setRecord((preRecord) => {
        const record = createRecordInstance({
          id: '',
          fields: version > 0 && preRecord?.fields ? preRecord.fields : initData,
        });
        record.updateCell = (fieldId: string, newValue: unknown) => {
          record.fields[fieldId] = newValue;
          updateVersion.inc();
          return Promise.resolve();
        };
        return record;
      });
    },
    [updateVersion]
  );

  useEffect(() => {
    if (!open) {
      updateVersion.reset();
      newRecord();
      return;
    }
    if (initialFields && Object.keys(initialFields).length > 0) {
      newRecord(0, initialFields);
    }
  }, [initialFields, newRecord, open, updateVersion]);

  useEffect(() => {
    // init record
    newRecord();
  }, [newRecord]);

  useEffect(() => {
    if (version > 0) {
      newRecord(version);
    }
  }, [version, newRecord]);

  useEffect(() => {
    if (!allFields.length) {
      return;
    }
    setRecord((record) =>
      record
        ? recordInstanceFieldMap(
            record,
            allFields.reduce(
              (acc, field) => {
                acc[field.id] = field;
                return acc;
              },
              {} as { [fieldId: string]: IFieldInstance }
            )
          )
        : record
    );
  }, [allFields, record]);

  useEffect(() => {
    if (!open) return;

    const updateDefaultValue = async () => {
      const fieldValue = await extractDefaultFieldsFromFilters({
        filter,
        fieldMap: keyBy(allFields, 'id'),
        currentUserId: userId,
        baseId,
        tableId,
        isAsync: true,
      });
      newRecord(0, { ...fieldValue, ...initialFields });
    };
    updateDefaultValue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const showFieldsId = useMemo(
    () =>
      new Set(showFields.filter((field) => field.canCreateFieldRecord).map((field) => field.id)),
    [showFields]
  );

  const fields = useMemo(
    () =>
      viewId
        ? allFields
            .filter((field) => field.canCreateFieldRecord)
            .filter((field) => showFieldsId.has(field.id))
        : allFields,
    [allFields, showFieldsId, viewId]
  );

  const hiddenFields = useMemo(
    () =>
      viewId
        ? allFields
            .filter((field) => field.canCreateFieldRecord)
            .filter((field) => !showFieldsId.has(field.id))
        : [],
    [allFields, showFieldsId, viewId]
  );

  const onChange = (newValue: unknown, fieldId: string) => {
    if (isEqual(record?.getCellValue(fieldId), newValue)) {
      return;
    }
    record?.updateCell(fieldId, newValue);
  };

  const handleCancel = useCallback(() => {
    if (tableId) {
      cancelPendingUploads(tableId, pendingRecordId);
    }
    setOpen(false);
  }, [cancelPendingUploads, pendingRecordId, tableId]);

  const title = t('editor.link.create');
  const editor = (
    <RecordEditor record={record} fields={fields} hiddenFields={hiddenFields} onChange={onChange} />
  );
  const actions = (
    <>
      <Button variant={'outline'} size={'sm'} onClick={handleCancel}>
        {t('common.cancel')}
      </Button>
      <Button
        className="relative overflow-hidden"
        size={'sm'}
        disabled={!tableId || isPending}
        onClick={() => {
          createRecord(record?.fields ?? {});
        }}
      >
        {isPending && <Spin className="size-4" />}
        {t('common.create')}
      </Button>
    </>
  );

  // In a table node it comes out as the record side panel does; elsewhere (a dialog, where the
  // panel would land behind the overlay, or a phone) it stays a dialog.
  if (inHost && !isMobile) {
    const trigger = isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(children)
      ? cloneElement(children, {
          onClick: (e: React.MouseEvent) => {
            children.props.onClick?.(e);
            setOpen(true);
            setRaiseKey((key) => key + 1);
          },
        })
      : children;
    return (
      <>
        {trigger}
        <Panel
          visible={open}
          onClose={handleCancel}
          crumb={{ title }}
          closeOnEscape={false}
          raiseKey={raiseKey}
        >
          <PendingUploadContext.Provider value={pendingUploadCtx}>
            <div className="flex h-full flex-col">
              <div className="flex h-12 shrink-0 items-center justify-end border-b px-4">
                <Button variant={'ghost'} size={'icon-xs'} onClick={handleCancel}>
                  <X className="size-4 shrink-0" />
                </Button>
              </div>
              <div className="shrink-0 px-6 pb-4 pt-5">
                <h2 className="mx-auto max-w-3xl truncate text-xl font-semibold tracking-tight">
                  {title}
                </h2>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
                <div className="mx-auto max-w-3xl">{editor}</div>
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">{actions}</div>
            </div>
          </PendingUploadContext.Provider>
        </Panel>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(val) => val && setOpen(val)}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        closeable={false}
        className="flex h-full max-w-3xl flex-col p-0 pt-6"
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <PendingUploadContext.Provider value={pendingUploadCtx}>
          <div className="flex-1 overflow-y-auto p-10 pt-4">{editor}</div>
          <div className="flex justify-end gap-4 border-t p-3">{actions}</div>
        </PendingUploadContext.Provider>
      </DialogContent>
    </Dialog>
  );
};
