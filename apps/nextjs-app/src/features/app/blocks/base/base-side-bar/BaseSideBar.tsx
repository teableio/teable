import { Gauge, Lock, MoreHorizontal, Settings, Trash2 } from '@teable/icons';
import { BillingProductLevel } from '@teable/openapi';
import { useBasePermission } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { AppWindowMac, Bot } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { UpgradeWrapper } from '@/features/app/components/billing/UpgradeWrapper';
import { useDisableAIAction } from '@/features/app/hooks/useDisableAIAction';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { tableConfig } from '@/features/i18n/table.config';
import { TableList } from '../../table-list/TableList';
import { QuickAction } from './QuickAction';

export const BaseSideBar = () => {
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();
  const isEE = useIsEE();
  const { buildApp: buildAppEnabled } = useDisableAIAction();

  const pageRoutes: {
    href: string;
    label: string;
    Icon: React.FC<{ className?: string }>;
    billingLevel?: BillingProductLevel;
  }[] = useMemo(
    () =>
      [
        {
          href: `/base/${baseId}/app`,
          label: t('common:noun.app'),
          Icon: AppWindowMac,
          hidden: !basePermission?.['base|create'] || !buildAppEnabled,
          billingLevel: BillingProductLevel.Pro,
        },
        {
          href: `/base/${baseId}/dashboard`,
          label: t('common:noun.dashboard'),
          Icon: Gauge,
          hidden: !basePermission?.['base|read'],
        },
        {
          href: `/base/${baseId}/automation`,
          label: t('common:noun.automation'),
          Icon: Bot,
          hidden: !basePermission?.['automation|read'],
          billingLevel: isEE ? BillingProductLevel.Pro : undefined,
        },
        {
          href: `/base/${baseId}/authority-matrix`,
          label: t('common:noun.authorityMatrix'),
          Icon: Lock,
          hidden: !basePermission?.['base|authority_matrix_config'],
          billingLevel: BillingProductLevel.Pro,
        },
      ].filter((item) => !item.hidden),
    [baseId, basePermission, buildAppEnabled, isEE, t]
  );

  return (
    <>
      <div className="flex flex-col gap-2 px-3">
        <div>
          <QuickAction>{t('common:quickAction.title')}</QuickAction>
        </div>
        <ul>
          {pageRoutes.map(({ href, label, Icon, billingLevel }) => {
            return (
              <UpgradeWrapper
                key={href}
                baseId={baseId as string}
                targetBillingLevel={billingLevel}
              >
                {({ badge }) => (
                  <li key={href}>
                    <Button
                      variant="ghost"
                      size="xs"
                      asChild
                      className={cn(
                        'w-full justify-start text-sm my-[2px]',
                        router.asPath.startsWith(href) && 'bg-secondary'
                      )}
                    >
                      <Link href={href} className="font-normal">
                        <Icon className="size-4 shrink-0" />
                        <p className="truncate">{label}</p>
                        <div className="grow basis-0"></div>
                        {badge}
                      </Link>
                    </Button>
                  </li>
                )}
              </UpgradeWrapper>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="my-[2px] w-full justify-start text-sm font-normal"
              >
                <MoreHorizontal className="size-4 shrink-0" />
                <p className="truncate">{t('common:actions.more')}</p>
                <div className="grow basis-0"></div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-[200px]">
              {basePermission?.['base|delete'] && (
                <DropdownMenuItem asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    asChild
                    className="my-[2px] w-full justify-start text-sm"
                  >
                    <Link href={`/base/${baseId}/trash`} className="font-normal">
                      <Trash2 className="size-4 shrink-0" />
                      <p className="truncate">{t('common:noun.trash')}</p>
                      <div className="grow basis-0"></div>
                    </Link>
                  </Button>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  asChild
                  className="my-[2px] w-full justify-start text-sm"
                >
                  <Link href={`/base/${baseId}/design`} className="font-normal">
                    <Settings className="size-4 shrink-0" />
                    <p className="truncate">{t('common:noun.design')}</p>
                    <div className="grow basis-0"></div>
                  </Link>
                </Button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ul>
      </div>
      <TableList />
    </>
  );
};
