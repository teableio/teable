import classNames from 'classnames';
import { useFieldStaticGetter } from '../../hooks';
import type { Field, Record } from '../../model';
import { CellEditor } from '../cell-value-editor';

export const RecordEditorItem = (props: {
  field: Field;
  record: Record | undefined;
  vertical?: boolean;
  onChange?: (newValue: unknown, fieldId: string) => void;
  disabled?: boolean;
}) => {
  const { field, record, vertical, onChange, disabled } = props;
  const { type, isLookup } = field;
  const fieldStaticeGetter = useFieldStaticGetter();
  const { Icon } = fieldStaticeGetter(type, isLookup);

  const cellValue = record?.getCellValue(field.id);
  const onChangeInner = (value: unknown) => {
    onChange?.(value, field.id);
  };

  return (
    <div className={vertical ? 'flex space-x-2' : 'space-y-2'}>
      <div className={classNames('w-36 flex items-top space-x-1', vertical ? 'pt-2' : 'w-full')}>
        <div className="flex h-5 w-5 items-center">
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
        wrapClassName="min-w-0 flex-1 p-0.5"
        cellValue={cellValue}
        onChange={onChangeInner}
        field={field}
        recordId={record?.id}
        disabled={!record || disabled}
      />
    </div>
  );
};
