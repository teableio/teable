import { Loader2 } from '@teable/icons';
import { LocalStorageKeys } from '@teable/sdk/config';
import { useFields, useTableId, useView } from '@teable/sdk/hooks';
import { type FormView } from '@teable/sdk/model';
import { Button, cn, useToast } from '@teable/ui-lib/shadcn';
import { omit } from 'lodash';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useLocalStorage, useMap, useSet } from 'react-use';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { tableConfig } from '@/features/i18n/table.config';
import { generateUniqLocalKey } from '../util';
import { FormField } from './FormField';

interface IFormBodyProps {
  className?: string;
  submit?: (fields: Record<string, unknown>) => Promise<void>;
}

export const FormBody = (props: IFormBodyProps) => {
  const { className, submit } = props;
  const tableId = useTableId();
  const view = useView() as FormView | undefined;
  const fields = useFields();
  const { toast } = useToast();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const localKey = generateUniqLocalKey(tableId, view?.id);
  const [formDataMap, setFormDataMap] = useLocalStorage<Record<string, Record<string, unknown>>>(
    LocalStorageKeys.ViewFromData,
    {}
  );
  const [formData, { set: setFormData, setAll: initFormData, remove: removeFormData }] = useMap<
    Record<string, unknown>
  >(formDataMap?.[localKey] ?? {});
  const [errors, { add: addError, remove: removeError, reset: resetErrors }] = useSet<string>(
    new Set([])
  );
  const [loading, setLoading] = useState(false);
  const previewUrl = usePreviewUrl();

  const visibleFields = useMemo(
    () => fields.filter(({ isComputed, isLookup }) => !isComputed && !isLookup),
    [fields]
  );

  if (view == null) return null;

  const { name, description, columnMeta } = view;

  const onChange = (fieldId: string, value: unknown) => {
    if (errors.has(fieldId) && value != null && value != '') {
      removeError(fieldId);
    }

    if (value == null) {
      removeFormData(fieldId);
      return setTimeout(() =>
        setFormDataMap({ ...formDataMap, [localKey]: omit(formData, fieldId) })
      );
    }

    setFormData(fieldId, value);

    // Store to local storage
    setTimeout(() =>
      setFormDataMap({
        ...formDataMap,
        [localKey]: {
          ...formData,
          [fieldId]: value,
        },
      })
    );
  };

  const onVerify = () => {
    resetErrors();

    const requiredFieldIds = visibleFields.reduce((acc, field) => {
      if (field.notNull || columnMeta[field.id].required) acc.push(field.id);
      return acc;
    }, [] as string[]);

    if (!requiredFieldIds.length) return true;

    let firstErrorFieldId = '';

    requiredFieldIds.forEach((fieldId) => {
      if (formData[fieldId] != null) return;
      if (!firstErrorFieldId) firstErrorFieldId = fieldId;
      addError(fieldId);
    });

    if (!firstErrorFieldId) return true;

    document
      .getElementById(`form-field-${firstErrorFieldId}`)
      ?.scrollIntoView({ behavior: 'smooth' });
    return false;
  };

  const onReset = () => {
    setLoading(false);
    initFormData({});
    setFormDataMap(omit(formDataMap, [localKey]));
  };

  const onSubmit = async () => {
    if (!onVerify()) return;

    setLoading(true);
    if (submit) {
      const finalData = visibleFields.reduce(
        (acc, field) => {
          acc[field.id] = formData[field.id];
          return acc;
        },
        {} as Record<string, unknown>
      );
      await submit(finalData);
    }

    setTimeout(() => {
      onReset();
      toast({
        title: t('actions.submitSucceed'),
        variant: 'default',
        duration: 2000,
      });
    }, 1000);
  };

  const { coverUrl, logoUrl, submitLabel } = view?.options ?? {};

  return (
    <div className={className}>
      <div
        className={cn(
          'relative h-36 w-full',
          !coverUrl &&
            'bg-gradient-to-tr from-green-400 via-blue-400 to-blue-600 dark:from-green-600 dark:via-blue-600 dark:to-blue-900'
        )}
      >
        {coverUrl && (
          <Image
            src={previewUrl(coverUrl)}
            alt="card cover"
            fill
            sizes="100%"
            style={{
              objectFit: 'cover',
            }}
          />
        )}
      </div>

      {logoUrl && (
        <div className="group absolute left-1/2 top-[104px] ml-[-40px] size-20">
          <Image
            className="rounded-lg object-cover shadow-sm"
            src={previewUrl(logoUrl)}
            alt="card cover"
            fill
            sizes="100%"
          />
        </div>
      )}

      <div
        className={cn(
          'mb-6 w-full px-6 text-center text-3xl leading-9 sm:px-12',
          logoUrl ? 'mt-16' : 'mt-8'
        )}
        style={{ overflowWrap: 'break-word' }}
      >
        {name ?? t('untitled')}
      </div>

      {description && <div className="mb-4 w-full px-12">{description}</div>}

      {Boolean(visibleFields.length) && (
        <div className="w-full px-6 sm:px-12">
          {visibleFields.map((field) => {
            const { id: fieldId } = field;
            return (
              <FormField
                key={fieldId}
                field={field}
                value={formData[fieldId] ?? null}
                errors={errors}
                onChange={(value) => onChange(fieldId, value)}
              />
            );
          })}

          <div className="mb-12 mt-8 flex w-full justify-center sm:mb-0 sm:px-12">
            <Button
              className="w-full text-base sm:w-56"
              size={'lg'}
              onClick={onSubmit}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {submitLabel || t('common:actions.submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
