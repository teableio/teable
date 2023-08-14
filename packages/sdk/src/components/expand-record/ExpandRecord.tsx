import { isEqual } from 'lodash';
import { useContext } from 'react';
import { useFields, useRecord } from '../../hooks';
import type { IExpandRecordModel } from './context';
import { ExpandRecordContext } from './context';
import { ExpandRecordTitle } from './ExpandRecordTitle';
import { ExpandRecordWrap } from './ExpandRecordWrap';
import { RecordEditor } from './RecordEditor';

interface IExpandRecordProps {
  recordId?: string;
  visible?: boolean;
  forceModel?: IExpandRecordModel;
  onClose?: () => void;
}

export const ExpandRecord = (props: IExpandRecordProps) => {
  const { recordId, visible, forceModel, onClose } = props;
  const { serverRecord, model } = useContext(ExpandRecordContext);
  const fields = useFields();
  const record = useRecord(recordId, serverRecord);
  const onChange = (newValue: unknown, fieldId: string) => {
    if (isEqual(record?.getCellValue(fieldId), newValue)) {
      return;
    }
    record?.updateCell(fieldId, newValue);
  };

  return (
    <ExpandRecordWrap model={forceModel || model} visible={visible} onClose={onClose}>
      <div className="h-full flex flex-col overflow-x-auto">
        <ExpandRecordTitle title={record?.name} onClose={onClose} />
        <div className="flex-1 pt-6 px-9 pb-9 min-w-[300px] overflow-y-scroll">
          {record ? (
            <RecordEditor record={record} fields={fields} onChange={onChange} />
          ) : (
            <span>Loading</span>
          )}
        </div>
      </div>
    </ExpandRecordWrap>
  );
};
