import { useTranslation } from '../../context/app/i18n';

export const ExpandRecordRight = () => {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center sm:w-80">
      {t('common.comingSoon')}
    </div>
  );
};
