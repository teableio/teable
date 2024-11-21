import type { ILookupOptionsRo, ILookupOptionsVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { useFields, useTable, useFieldStaticGetter, useBaseId } from '@teable/sdk/hooks';
import type { IFieldInstance, LinkField } from '@teable/sdk/model';
import { Button } from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { tableConfig } from '@/features/i18n/table.config';
import { LookupFilterOptions } from './LookupFilterOptions';

const SelectFieldByTableId: React.FC<{
  selectedId?: string;
  onChange: (lookupField: IFieldInstance) => void;
}> = ({ selectedId, onChange }) => {
  const fields = useFields({ withHidden: true, withDenied: true });
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
  fieldId?: string;
  onChange?: (
    options: Partial<ILookupOptionsRo>,
    linkField?: LinkField,
    lookupField?: IFieldInstance
  ) => void;
}) => {
  const { fieldId, options = {}, onChange } = props;
  const fields = useFields({ withHidden: true, withDenied: true });
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [innerOptions, setInnerOptions] = useState<Partial<ILookupOptionsRo>>({
    foreignTableId: options.foreignTableId,
    linkFieldId: options.linkFieldId,
    lookupFieldId: options.lookupFieldId,
  });
  const baseId = useBaseId();

  const [moreVisible, setMoreVisible] = useState(Boolean(options?.filter));

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
              placeholder={t('table:field.editor.selectField')}
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
            <>
              <StandaloneViewProvider baseId={baseId} tableId={innerOptions.foreignTableId}>
                <SelectFieldByTableId
                  selectedId={innerOptions.lookupFieldId}
                  onChange={(lookupField: IFieldInstance) => {
                    const linkField = linkFields.find(
                      (l) => l.id === innerOptions.linkFieldId
                    ) as LinkField;
                    setOptions?.({ lookupFieldId: lookupField.id }, linkField, lookupField);
                  }}
                />
              </StandaloneViewProvider>
              <>
                <div className="flex justify-end">
                  <Button
                    size="xs"
                    variant="link"
                    className="text-xs text-slate-500 underline"
                    onClick={() => setMoreVisible(!moreVisible)}
                  >
                    {t('table:field.editor.moreOptions')}
                  </Button>
                </div>
                {moreVisible && (
                  <LookupFilterOptions
                    fieldId={fieldId}
                    foreignTableId={innerOptions.foreignTableId}
                    filter={options.filter}
                    onChange={(filter) => {
                      setOptions?.({ filter });
                    }}
                  />
                )}
              </>
            </>
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
