import { Key } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';

export enum SettingSidebarTab {
  PersonalAccessTokens,
}

interface ISidebarContentProps {
  active?: SettingSidebarTab;
}
export const SidebarContent = (props: ISidebarContentProps) => {
  const { active } = props;
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);
  return (
    <div className="space-y-1">
      <Button
        className="space-x-2"
        variant={active === SettingSidebarTab.PersonalAccessTokens ? 'secondary' : 'ghost'}
      >
        <Key />
        {t('token:title')}
      </Button>
    </div>
  );
};
