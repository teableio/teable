import { Gauge, PackageCheck } from '@teable/icons';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { TableList } from '../../table-list/TableList';
import { QuickAction } from './QuickAction';

export const BaseSideBar = () => {
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const pageRoutes: {
    href: string;
    text: string;
    Icon: React.FC<{ className?: string }>;
    disabled?: boolean;
  }[] = [
    {
      href: `/base/${baseId}/dashboard`,
      text: t('common:noun.dashboard'),
      Icon: Gauge,
    },
    {
      href: `/base/${baseId}/automation`,
      text: t('common:noun.automation'),
      Icon: PackageCheck,
      disabled: true,
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-2 px-3">
        <div>
          <QuickAction>{t('space:quickAction.title')}</QuickAction>
        </div>
        <ul>
          {pageRoutes.map(({ href, text, Icon, disabled }) => {
            return (
              <li key={href}>
                <Button
                  variant="ghost"
                  size={'xs'}
                  asChild
                  className={cn(
                    'w-full justify-start text-sm px-2 my-[2px]',
                    href === router.pathname && 'bg-secondary'
                  )}
                  disabled={disabled}
                >
                  <Link href={href} className="font-normal">
                    <Icon className="size-4 shrink-0" />
                    <p className="truncate">{text}</p>
                    <div className="grow basis-0"></div>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      <TableList />
    </>
  );
};
