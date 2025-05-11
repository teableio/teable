import { useMutation } from '@tanstack/react-query';
import { FieldKeyType } from '@teable/core';
import { createRecords } from '@teable/openapi';
import { Dialog, DialogTrigger, DialogContent, Spin, Button } from '@teable/ui-lib';
import { isEqual, keyBy } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCounter } from 'react-use';
import { useTranslation } from '../../context/app/i18n';
import { useBaseId, useFields, useSession, useTableId, useView, useViewId } from '../../hooks';
import type { IFieldInstance, Record } from '../../model';
import { createRecordInstance, recordInstanceFieldMap } from '../../model';
import { extractDefaultFieldsFromFilters } from '../../utils/filterWithDefaultValue';
import { RecordEditor } from '../expand-record/RecordEditor';

interface ICreateRecordModalProps {
  children?: React.ReactNode;
  callback?: (recordId: string) => void;
}

export const CreateRecordModal = (props: ICreateRecordModalProps) => {
  const { children, callback } = props;
  const tableId = useTableId();
  const baseId = useBaseId();
  const viewId = useViewId();
  const view = useView();
  const showFields = useFields();
  const [open, setOpen] = useState(false);
  const [version, updateVersion] = useCounter(0);
  const { t } = useTranslation();
  const allFields = useFields({ withHidden: true });
  const { user } = useSession();
  const [record, setRecord] = useState<Record | undefined>(undefined);
  const filter = view?.filter;
  const userId = user.id;

  const { mutate: createRecord, isLoading } = useMutation({
    mutationFn: (fields: { [fieldId: string]: unknown }) =>
      createRecords(tableId!, {
        records: [{ fields }],
        fieldKeyType: FieldKeyType.Id,
      }),
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
    }
  }, [newRecord, open, updateVersion]);

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
      newRecord(0, fieldValue);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        closeable={false}
        className="flex h-full max-w-3xl flex-col p-0 pt-6"
        style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto p-10 pt-4">
          <RecordEditor
            record={record}
            fields={fields}
            hiddenFields={hiddenFields}
            onChange={onChange}
          />
        </div>
        <div className="flex justify-end gap-4 border-t px-10 py-3">
          <Button variant={'outline'} size={'sm'} onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            className="relative overflow-hidden"
            size={'sm'}
            disabled={!tableId || isLoading}
            onClick={() => {
              createRecord(record?.fields ?? {});
            }}
          >
            {isLoading && (
              <div className="absolute flex size-full items-center justify-center">
                <Spin className="mr-2" />
              </div>
            )}
            {t('common.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
