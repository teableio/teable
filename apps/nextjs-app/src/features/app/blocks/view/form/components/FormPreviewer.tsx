import { Loader2 } from '@teable-group/icons';
import { LocalStorageKeys } from '@teable-group/sdk/config';
import { useFields, useTable, useView } from '@teable-group/sdk/hooks';
import type { FormView } from '@teable-group/sdk/model';
import { Button, cn, useToast } from '@teable-group/ui-lib/shadcn';
import { omit } from 'lodash';
import { useMemo, useRef, useState } from 'react';
import { useLocalStorage, useMap, useSet } from 'react-use';
import { generateUniqLocalKey } from '../util';
import { FormField } from './FormField';

export const FormPreviewer = () => {
  const table = useTable();
  const view = useView();
  const fields = useFields();
  const { toast } = useToast();
  const localKey = generateUniqLocalKey(table?.id, view?.id);
  const [formDataMap, setFormDataMap] = useLocalStorage<Record<string, Record<string, unknown>>>(
    LocalStorageKeys.ViewFromData,
    {}
  );
  const [formData, { set: setFormData, reset: resetFormData }] = useMap<Record<string, unknown>>(
    formDataMap?.[localKey] ?? {}
  );
  const [errors, { add: addError, remove: removeError, reset: resetErrors }] = useSet<string>(
    new Set([])
  );
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleFields = useMemo(
    () => fields.filter(({ isComputed, isLookup }) => !isComputed && !isLookup),
    [fields]
  );

  if (view == null) return null;

  const { id: viewId, name, description } = view;

  const onChange = (fieldId: string, value: unknown) => {
    if (errors.has(fieldId) && value != null && value != '') {
      removeError(fieldId);
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
      if (field.columnMeta[viewId].required) acc.push(field.id);
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
    resetFormData();
    setFormDataMap(omit(formDataMap, [localKey]));
  };

  const onSubmit = () => {
    if (!onVerify()) return;

    setLoading(true);
    table?.createRecord(formData);

    setTimeout(() => {
      onReset();
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      toast({
        title: 'Submit success',
        variant: 'default',
        duration: 2000,
      });
    }, 1000);
  };

  const coverUrl = (view as FormView)?.options?.coverUrl;

  return (
    <div
      className={cn(
        'w-full overflow-y-auto sm:py-8',
        loading && 'pointer-events-none cursor-not-allowed'
      )}
      ref={containerRef}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col items-center overflow-hidden pb-12 shadow-md sm:rounded-lg sm:border">
        <div
          className={cn(
            'relative h-36 w-full',
            !coverUrl &&
              'bg-gradient-to-tr from-green-400 via-blue-400 to-blue-600 dark:from-green-600 dark:via-blue-600 dark:to-blue-900'
          )}
        >
          {coverUrl && (
            <img
              src={(view as FormView)?.options?.coverUrl}
              alt="form cover"
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="mb-6 mt-8 h-9 w-1/2 text-center text-3xl leading-9">
          {name ?? 'Untitled'}
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
                className="w-full text-base sm:w-48"
                size={'lg'}
                onClick={onSubmit}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
