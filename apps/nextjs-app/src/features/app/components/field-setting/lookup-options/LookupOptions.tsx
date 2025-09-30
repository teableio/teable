import type { ILookupOptionsRo, ILookupOptionsVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { ChevronDown } from '@teable/icons';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { useFields, useTable, useFieldStaticGetter, useBaseId } from '@teable/sdk/hooks';
import type { IFieldInstance, LinkField } from '@teable/sdk/model';
import { Button } from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { tableConfig } from '@/features/i18n/table.config';
import { LookupFilterOptions } from './LookupFilterOptions';

export const SelectFieldByTableId: React.FC<{
  selectedId?: string;
  onChange: (lookupField: IFieldInstance) => void;
}> = ({ selectedId, onChange }) => {
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <Selector
      className="w-full"
      placeholder={t('table:field.editor.selectField')}
      selectedId={selectedId}
      onChange={(id) => {
        onChange(fields.find((f) => f.id === id) as IFieldInstance);
      }}
      candidates={fields.map((f) => {
        const Icon = getFieldStatic(f.type, {
          isLookup: f.isLookup,
          hasAiConfig: Boolean(f.aiConfig),
        }).Icon;
        return {
          id: f.id,
          name: f.name,
          icon: <Icon className="size-4 shrink-0" />,
        };
      })}
    />
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
  const table = useTable();
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
    <div className="w-full space-y-4 border-t pt-4" data-testid="lookup-options">
      {existLinkField ? (
        <>
          <div className="space-y-2">
            <span className="neutral-content text-sm font-medium">
              {t('table:field.editor.linkFieldToLookup')}
              <RequireCom />
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
                <div className="space-y-2">
                  <span className="neutral-content mb-2 text-sm font-medium">
                    <Trans
                      ns="table"
                      i18nKey="field.editor.lookupToTable"
                      values={{
                        tableName: table?.name,
                      }}
                    />
                    <RequireCom />
                  </span>
                  <SelectFieldByTableId
                    selectedId={innerOptions.lookupFieldId}
                    onChange={(lookupField: IFieldInstance) => {
                      const linkField = linkFields.find(
                        (l) => l.id === innerOptions.linkFieldId
                      ) as LinkField;
                      setOptions?.({ lookupFieldId: lookupField.id }, linkField, lookupField);
                    }}
                  />
                </div>
              </StandaloneViewProvider>
              <>
                <div className="flex justify-start">
                  <Button
                    size="xs"
                    variant="outline"
                    className=""
                    onClick={() => setMoreVisible(!moreVisible)}
                  >
                    {t('table:field.editor.moreOptions')}
                    <ChevronDown className="size-3 " />
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
