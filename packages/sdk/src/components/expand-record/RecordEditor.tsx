import { Button } from '@teable/ui-lib';
import { useRef } from 'react';
import { useLocalStorage, useMeasure } from 'react-use';
import { LocalStorageKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import type { IButtonClickStatusHook } from '../../hooks';
import type { IFieldInstance, Record } from '../../model';
import { RecordEditorItem } from './RecordEditorItem';

// eslint-disable-next-line @typescript-eslint/naming-convention
const EDITOR_VERTICAL_MIN = 570;

export const RecordEditor = (props: {
  fields: IFieldInstance[];
  record: Record | undefined;
  hiddenFields?: IFieldInstance[];
  onChange?: (newValue: unknown, fieldId: string) => void;
  readonly?: boolean | ((field: IFieldInstance) => boolean);
  buttonClickStatusHook?: IButtonClickStatusHook;
}) => {
  const { t } = useTranslation();
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { fields, hiddenFields = [], record, onChange, readonly, buttonClickStatusHook } = props;
  const vertical = width > EDITOR_VERTICAL_MIN;
  const [hiddenFieldsVisible, setHiddenFieldsVisible] = useLocalStorage(
    LocalStorageKeys.ExpandRecordHiddenFieldsVisible,
    false
  );

  return (
    <div ref={ref} className="max-w-3xl">
      <div ref={wrapRef} className="mx-auto space-y-6">
        {fields.map((field) => (
          <RecordEditorItem
            key={field.id}
            vertical={vertical}
            field={field}
            record={record}
            onChange={onChange}
            readonly={typeof readonly === 'function' ? readonly(field) : readonly}
            buttonClickStatusHook={buttonClickStatusHook}
          />
        ))}
        {hiddenFields.length !== 0 && (
          <div className="flex items-center gap-2">
            <div className="border-top-width h-px flex-1 bg-border" />
            <Button
              size={'xs'}
              variant={'outline'}
              onClick={() => setHiddenFieldsVisible(!hiddenFieldsVisible)}
            >
              {hiddenFieldsVisible
                ? t('expandRecord.hideHiddenFields', { count: hiddenFields.length })
                : t('expandRecord.showHiddenFields', { count: hiddenFields.length })}
            </Button>
            <div className="border-top-width h-px flex-1 bg-border" />
          </div>
        )}
        {hiddenFieldsVisible &&
          hiddenFields?.map((field) => (
            <RecordEditorItem
              key={field.id}
              vertical={vertical}
              field={field}
              record={record}
              onChange={onChange}
              readonly={typeof readonly === 'function' ? readonly(field) : readonly}
              buttonClickStatusHook={buttonClickStatusHook}
            />
          ))}
      </div>
    </div>
  );
};
