import type { ICrossSpaceTableAffectedField } from '@teable/openapi';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'next-i18next';

export const TableDuplicateConversionWarning = ({
  fields,
}: {
  fields: ICrossSpaceTableAffectedField[] | undefined;
}) => {
  const { t } = useTranslation(['common', 'table']);
  if (!fields?.length) return null;
  return (
    <div className="mt-3 space-y-3 rounded-md bg-muted/50 p-3 text-sm leading-5">
      <h4 className="flex items-center gap-2 font-medium">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {t('common:operationPreview.changedEffectsTitle')}
      </h4>
      <p>{t('table:crossSpace.duplicateTableDescription')}</p>
      <ul className="max-h-40 space-y-1 overflow-y-auto break-words font-medium">
        {fields.map((field) => (
          <li key={field.fieldId}>{field.fieldName}</li>
        ))}
      </ul>
    </div>
  );
};
