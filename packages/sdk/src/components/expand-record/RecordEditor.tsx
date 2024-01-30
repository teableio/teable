import { Button } from '@teable/ui-lib';
import { useRef } from 'react';
import { useMeasure, useToggle } from 'react-use';
import type { Field, Record } from '../../model';
import { RecordEditorItem } from './RecordEditorItem';

// eslint-disable-next-line @typescript-eslint/naming-convention
const EDITOR_VERTICAL_MIN = 570;

export const RecordEditor = (props: {
  fields: Field[];
  record: Record | undefined;
  hiddenFields?: Field[];
  onChange?: (newValue: unknown, fieldId: string) => void;
  readonly?: boolean;
}) => {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { fields, hiddenFields = [], record, onChange, readonly } = props;
  const vertical = width > EDITOR_VERTICAL_MIN;
  const [showHiddenFields, toggle] = useToggle(false);

  return (
    <div ref={ref} className="max-w-2xl">
      <div ref={wrapRef} className="mx-auto space-y-6">
        {fields.map((field) => (
          <RecordEditorItem
            key={field.id}
            vertical={vertical}
            field={field}
            record={record}
            onChange={onChange}
            readonly={readonly}
          />
        ))}
        {hiddenFields.length !== 0 && (
          <div className="flex items-center gap-2">
            <div className="border-top-width h-[1px] flex-1 bg-border" />
            <Button variant={'outline'} size={'xs'} onClick={toggle}>
              {showHiddenFields ? 'Hide' : 'Show'} {hiddenFields.length} hidden field
            </Button>
            <div className="border-top-width h-[1px] flex-1 bg-border" />
          </div>
        )}
        {showHiddenFields &&
          hiddenFields?.map((field) => (
            <RecordEditorItem
              key={field.id}
              vertical={vertical}
              field={field}
              record={record}
              onChange={onChange}
              readonly={readonly}
            />
          ))}
      </div>
    </div>
  );
};
