import type { IFieldVo } from '@teable/core';
import { LocalStorageKeys } from '@teable/sdk/config/local-storage-keys';
import { Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useLocalStorage } from 'react-use';

export const DbFieldName: React.FC<{
  field: Partial<IFieldVo>;
  updateFieldProps: (props: Partial<IFieldVo>) => void;
}> = ({ field, updateFieldProps }) => {
  const { t } = useTranslation(['table']);
  return (
    <>
      <p className="label-text">{t('table:field.editor.dbFieldName')}</p>
      <Input
        placeholder={t('table:field.editor.dbFieldName')}
        type="text"
        className="h-8"
        value={field['dbFieldName'] || ''}
        data-1p-ignore="true"
        autoComplete="off"
        onChange={(e) => updateFieldProps({ dbFieldName: e.target.value || undefined })}
      />
    </>
  );
};

const FieldInfoList: React.FC<{ field: Partial<IFieldVo> }> = ({ field }) => (
  <div className="flex flex-col space-y-1">
    {[
      { label: 'id', value: field.id },
      { label: 'dbFieldType', value: field.dbFieldType },
      { label: 'cellValueType', value: field.cellValueType },
      { label: 'isMultipleCellValue', value: field.isMultipleCellValue ? 'true' : 'false' },
      { label: 'isPrimary', value: field.isPrimary ? 'true' : 'false' },
      { label: 'isComputed', value: field.isComputed ? 'true' : 'false' },
      { label: 'isPending', value: field.isPending ? 'true' : 'false' },
    ].map(({ label, value }) => (
      <p key={label} className="text-xs">
        <span className="select-none text-slate-400">{label}: </span>
        {value}
      </p>
    ))}
  </div>
);

const ToggleButton: React.FC<{
  show?: boolean;
  setShow: (value: boolean) => void;
}> = ({ show, setShow }) => {
  const { t } = useTranslation(['table']);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      setShow(!show);
    }
  };

  return (
    <span
      onClick={() => setShow(!show)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      className="cursor-pointer border-b border-solid border-slate-500"
    >
      {t(show ? 'field.hide' : 'field.advancedProps')}
    </span>
  );
};

export const SystemInfo: React.FC<{
  field: Partial<IFieldVo>;
  updateFieldProps: (props: Partial<IFieldVo>) => void;
}> = ({ field, updateFieldProps }) => {
  const [show, setShow] = useLocalStorage<boolean>(LocalStorageKeys.FieldSystem);

  if (!show) {
    return (
      <div className="absolute right-0">
        <p className="text-xs font-medium text-slate-500">
          <ToggleButton show={show} setShow={setShow} />
        </p>
      </div>
    );
  }

  return (
    <>
      {field.id ? (
        <div className="flex flex-col space-y-1">
          <p>
            <DbFieldName field={field} updateFieldProps={updateFieldProps} />
          </p>
          <FieldInfoList field={field} />
        </div>
      ) : (
        <div className="flex flex-col space-y-2">
          <DbFieldName field={field} updateFieldProps={updateFieldProps} />
        </div>
      )}
      <p className="border-b border-slate-200 pb-2 text-xs">
        <ToggleButton show={show} setShow={setShow} />
      </p>
    </>
  );
};
