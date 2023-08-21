import type { IRecord } from '@teable-group/core';
import { Skeleton } from '@teable-group/ui-lib';
import { isEqual } from 'lodash';
import { useFields, useRecord } from '../../hooks';
import { ExpandRecordHeader } from './ExpandRecordHeader';
import { ExpandRecordWrap } from './ExpandRecordWrap';
import { RecordEditor } from './RecordEditor';
import { useExpandRecord } from './store';
import type { IExpandRecordModel } from './type';

interface IExpandRecordProps {
  recordId?: string;
  visible?: boolean;
  forceModel?: IExpandRecordModel;
  serverData?: IRecord;
  onClose?: () => void;
}

export const ExpandRecord = (props: IExpandRecordProps) => {
  const { recordId, visible, forceModel, serverData, onClose } = props;
  const { model } = useExpandRecord();
  const fields = useFields();
  const record = useRecord(recordId, serverData);
  const onChange = (newValue: unknown, fieldId: string) => {
    if (isEqual(record?.getCellValue(fieldId), newValue)) {
      return;
    }
    record?.updateCell(fieldId, newValue);
  };

  return (
    <ExpandRecordWrap model={forceModel || model} visible={visible} onClose={onClose}>
      <div className="h-full flex flex-col overflow-x-auto">
        <ExpandRecordHeader title={record?.name} onClose={onClose} />
        <div className="flex-1 pt-6 px-9 pb-9 min-w-[300px] overflow-y-scroll">
          {fields.length > 0 ? (
            <RecordEditor record={record} fields={fields} onChange={onChange} />
          ) : (
            <Skeleton className="h-10 w-full rounded" />
          )}
        </div>
      </div>
    </ExpandRecordWrap>
  );
};
