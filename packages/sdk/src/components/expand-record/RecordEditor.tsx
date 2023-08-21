import classNames from 'classnames';
import { useMeasure } from 'react-use';
import { useFieldStaticGetter } from '../../hooks';
import type { Field, Record } from '../../model';
import { CellEditor } from '../cell-value-editor';

// eslint-disable-next-line @typescript-eslint/naming-convention
const EDITOR_VERTICAL_MIN = 570;

export const RecordEditor = (props: {
  fields: Field[];
  record: Record | undefined;
  onChange?: (newValue: unknown, fieldId: string) => void;
}) => {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const { fields, record, onChange } = props;
  const vertical = width > EDITOR_VERTICAL_MIN;
  return (
    <div ref={ref} className="max-w-2xl mx-auto space-y-6">
      {fields.map((field) => (
        <RecordEditorItem
          key={field.id}
          vertical={vertical}
          field={field}
          record={record}
          onChange={onChange}
        />
      ))}
    </div>
  );
};

const RecordEditorItem = (props: {
  field: Field;
  record: Record | undefined;
  vertical?: boolean;
  onChange?: (newValue: unknown, fieldId: string) => void;
}) => {
  const { field, record, vertical, onChange } = props;
  const { type, isLookup } = field;
  const fieldStaticeGetter = useFieldStaticGetter();
  const { Icon } = fieldStaticeGetter(type, isLookup);

  const cellValue = record?.getCellValue(field.id);
  const onChangeInner = (value: unknown) => {
    onChange?.(value, field.id);
  };

  return (
    <div className={classNames('space-y-2', vertical && 'flex space-y-0 space-x-2')}>
      <div className={classNames('w-full flex items-top space-x-1', vertical && 'w-36')}>
        <div className="w-5 h-5 flex items-center">
          <Icon />
        </div>
        <div
          className={classNames(
            'text-sm flex-1 truncate',
            vertical && 'break-words whitespace-normal'
          )}
        >
          {field.name}
        </div>
      </div>
      <CellEditor
        className="min-w-0 flex-1 p-0.5"
        cellValue={cellValue}
        onChange={onChangeInner}
        field={field}
        disabled={!record}
      />
    </div>
  );
};
