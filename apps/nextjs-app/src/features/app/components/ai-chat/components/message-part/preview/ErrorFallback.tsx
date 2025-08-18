import { useTranslation } from 'next-i18next';

export const ErrorFallback = () => {
  const { t } = useTranslation(['table']);
  return (
    <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 p-4">
      <div className="text-center text-sm text-gray-500">
        {t('table:aiChat.fallback.previewLoadFailed')}
      </div>
    </div>
  );
};
