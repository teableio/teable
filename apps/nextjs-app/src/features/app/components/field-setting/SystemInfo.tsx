import type { IFieldVo } from '@teable/core';
import { LocalStorageKeys } from '@teable/sdk/config/local-storage-keys';
import { Input, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useLocalStorage } from 'react-use';

export const DbFieldName: React.FC<{
  field: Partial<IFieldVo>;
  updateFieldProps: (props: Partial<IFieldVo>) => void;
}> = ({ field, updateFieldProps }) => {
  const { t } = useTranslation(['table']);
  return (
    <>
      <div className="mt-2 flex flex-col space-y-2">
        <p className="text-sm font-medium">{t('table:field.editor.dbFieldName')}</p>
        <Input
          placeholder={t('table:field.editor.dbFieldName')}
          type="text"
          className="h-9"
          value={field['dbFieldName'] || ''}
          data-1p-ignore="true"
          autoComplete="off"
          onChange={(e) => updateFieldProps({ dbFieldName: e.target.value || undefined })}
        />
      </div>
    </>
  );
};

const FieldInfoList: React.FC<{ field: Partial<IFieldVo> }> = ({ field }) => (
  <div className="mt-2 flex flex-col gap-2 rounded-md border bg-muted p-3">
    {[
      { label: 'id', value: field.id },
      { label: 'dbFieldType', value: field.dbFieldType },
      { label: 'cellValueType', value: field.cellValueType },
      { label: 'isMultipleCellValue', value: field.isMultipleCellValue ? 'true' : 'false' },
      { label: 'isPrimary', value: field.isPrimary ? 'true' : 'false' },
      { label: 'isComputed', value: field.isComputed ? 'true' : 'false' },
      { label: 'isPending', value: field.isPending ? 'true' : 'false' },
    ].map(({ label, value }) => (
      <p key={label} className="h-4 text-xs ">
        <span className="mr-1 select-none text-muted-foreground">{label}: </span>
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
    <Button
      size="xs"
      variant={show ? 'outline' : 'link'}
      onClick={() => {
        setShow(!show);
      }}
      className={show ? '' : 'h-5 text-xs text-muted-foreground decoration-muted-foreground'}
    >
      {t(show ? 'field.hide' : 'field.advancedProps')}
    </Button>
  );
};

export const SystemInfo: React.FC<{
  field: Partial<IFieldVo>;
  updateFieldProps: (props: Partial<IFieldVo>) => void;
}> = ({ field, updateFieldProps }) => {
  const [show, setShow] = useLocalStorage<boolean>(LocalStorageKeys.FieldSystem);

  if (!show) {
    return (
      <div className="absolute right-0 top-[2px] cursor-pointer">
        <ToggleButton show={show} setShow={setShow} />
      </div>
    );
  }

  return (
    <>
      {field.id ? (
        <div className="flex flex-col space-y-2">
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
      <p className="mb-2 border-b pb-4 text-xs">
        <ToggleButton show={show} setShow={setShow} />
      </p>
    </>
  );
};
