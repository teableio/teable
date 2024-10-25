import { useTranslation } from '../../context/app/i18n';

export const useAttachmentPreviewI18Map = () => {
  const { t } = useTranslation();
  return {
    previewFileLimit: t('preview.previewFileLimit', { size: 10 }),
    loadFileError: t('preview.loadFileError'),
  };
};
