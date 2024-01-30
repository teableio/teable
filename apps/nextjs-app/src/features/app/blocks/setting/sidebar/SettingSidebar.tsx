import { TeableNew } from '@teable-group/icons';
import { Separator } from '@teable-group/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface ISettingSidebarProps {
  children: React.ReactNode;
}
export const SettingSidebar = (props: ISettingSidebarProps) => {
  const { children } = props;
  const { t } = useTranslation('common');
  return (
    <div className="mr-10 min-w-52">
      <div className="flex h-20 items-center">
        <TeableNew className="text-3xl text-black" />
        <h1 className="ml-2 text-2xl font-semibold">{t('settings.title')}</h1>
      </div>
      <Separator />
      <div className="mt-4">{children}</div>
    </div>
  );
};
