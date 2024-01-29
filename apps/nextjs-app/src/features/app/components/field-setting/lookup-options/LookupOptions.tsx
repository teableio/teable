import type { ILookupOptionsRo, ILookupOptionsVo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { AnchorProvider } from '@teable-group/sdk/context';
import { useFields, useTable, useFieldStaticGetter } from '@teable-group/sdk/hooks';
import type { IFieldInstance, LinkField } from '@teable-group/sdk/model';
import { Selector } from '@teable-group/ui-lib/base';
import { useCallback, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { tableConfig } from '@/features/i18n/table.config';

const SelectFieldByTableId: React.FC<{
  selectedId?: string;
  onChange: (lookupField: IFieldInstance) => void;
}> = ({ selectedId, onChange }) => {
  const fields = useFields();
  const table = useTable();
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <div className="space-y-2">
      <span className="neutral-content label-text mb-2">
        <Trans
          ns="table"
          i18nKey="field.editor.lookupToTable"
          values={{
            tableName: table?.name,
          }}
        />
      </span>
      <Selector
        className="w-full"
        placeholder={t('table:field.editor.selectField')}
        selectedId={selectedId}
        onChange={(id) => {
          onChange(fields.find((f) => f.id === id) as IFieldInstance);
        }}
        candidates={fields.map((f) => {
          const Icon = getFieldStatic(f.type, f.isLookup).Icon;
          return {
            id: f.id,
            name: f.name,
            icon: <Icon className="size-4 shrink-0" />,
          };
        })}
      />
    </div>
  );
};

export const LookupOptions = (props: {
  options: Partial<ILookupOptionsVo> | undefined;
  onChange?: (
    options: Partial<ILookupOptionsRo>,
    linkField?: LinkField,
    lookupField?: IFieldInstance
  ) => void;
}) => {
  const { options = {}, onChange } = props;
  const fields = useFields();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [innerOptions, setInnerOptions] = useState<Partial<ILookupOptionsRo>>({
    foreignTableId: options.foreignTableId,
    linkFieldId: options.linkFieldId,
    lookupFieldId: options.lookupFieldId,
  });

  const setOptions = useCallback(
    (options: Partial<ILookupOptionsRo>, linkField?: LinkField, lookupField?: IFieldInstance) => {
      onChange?.({ ...innerOptions, ...options }, linkField, lookupField);
      setInnerOptions({ ...innerOptions, ...options });
    },
    [innerOptions, onChange]
  );

  const linkFields = useMemo(
    () => fields.filter((f) => f.type === FieldType.Link && !f.isLookup) as LinkField[],
    [fields]
  );
  const existLinkField = linkFields.length > 0;

  return (
    <div className="w-full space-y-2" data-testid="lookup-options">
      {existLinkField ? (
        <>
          <div className="space-y-2">
            <span className="neutral-content label-text">
              {t('table:field.editor.linkFieldToLookup')}
            </span>
            <Selector
              className="w-full"
              placeholder={t('table:field.editor.selectTable')}
              selectedId={options.linkFieldId}
              onChange={(selected: string) => {
                const selectedLinkField = linkFields.find((l) => l.id === selected);
                setOptions({
                  linkFieldId: selected,
                  foreignTableId: selectedLinkField?.options.foreignTableId,
                });
              }}
              candidates={linkFields}
            />
          </div>
          {innerOptions.foreignTableId && (
            <AnchorProvider tableId={innerOptions.foreignTableId}>
              <SelectFieldByTableId
                selectedId={innerOptions.lookupFieldId}
                onChange={(lookupField: IFieldInstance) => {
                  const linkField = linkFields.find(
                    (l) => l.id === innerOptions.linkFieldId
                  ) as LinkField;
                  setOptions?.({ lookupFieldId: lookupField.id }, linkField, lookupField);
                }}
              />
            </AnchorProvider>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <span className="neutral-content label-text mb-2">
            {t('table:field.editor.noLinkTip')}
          </span>
        </div>
      )}
    </div>
  );
};
