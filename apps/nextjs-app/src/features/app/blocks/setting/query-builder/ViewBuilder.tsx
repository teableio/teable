import { useViews } from '@teable/sdk/hooks';
import { useTranslation } from 'next-i18next';
import { Selector } from '@/components/Selector';
import { developerConfig } from '@/features/i18n/developer.config';

export const ViewBuilder = ({
  viewId,
  onChange,
}: {
  viewId?: string;
  onChange: (viewId: string | undefined) => void;
}) => {
  const views = useViews();
  const { t } = useTranslation(developerConfig.i18nNamespaces);

  return (
    <Selector
      className="w-80"
      selectedId={viewId}
      onChange={(id) => onChange(id || undefined)}
      candidates={views}
      placeholder={t('sdk:common.selectPlaceHolder')}
    />
  );
};
