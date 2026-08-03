import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';

export const useAttachmentPreviewI18Map = () => {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      previewFileLimit: t('preview.previewFileLimit', { size: 10 }),
      loadFileError: t('preview.loadFileError'),
      // Text preview caps at 1MB (~500k chars) — anything larger strains <pre>
      // rendering and is better served by a download. Reuses the same
      // translation template so we don't churn 10 locale files.
      textPreviewFileLimit: t('preview.previewFileLimit', { size: 1 }),
    }),
    [t]
  );
};
