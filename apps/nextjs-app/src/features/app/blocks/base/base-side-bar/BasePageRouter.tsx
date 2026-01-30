import { Lock, MoreHorizontal, Settings, Trash2 } from '@teable/icons';
import { BillingProductLevel } from '@teable/openapi';
import { useBasePermission, useIsTemplate } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { UpgradeWrapper } from '@/features/app/components/billing/UpgradeWrapper';
import { ShareBaseDialog } from '@/features/app/components/collaborator/share/ShareBaseDialog';
import { tableConfig } from '@/features/i18n/table.config';

const MoreMenu = () => {
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();

  const canUpdateBase = Boolean(basePermission?.['base|update']);
  if (!canUpdateBase) {
    return null;
  }

  return (
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
  );
};

export const BasePageRouter = () => {
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();
  const isTemplate = useIsTemplate();

  const pageRoutes: {
    href: string;
    label: string;
    Icon: React.FC<{ className?: string }>;
    billingLevel?: BillingProductLevel;
  }[] = useMemo(
    () =>
      [
        {
          href: `/base/${baseId}/authority-matrix`,
          label: t('common:noun.authorityMatrix'),
          Icon: Lock,
          hidden: !basePermission?.['base|authority_matrix_config'],
          billingLevel: BillingProductLevel.Business,
        },
      ].filter((item) => !item.hidden),
    [baseId, basePermission, t]
  );

  if (isTemplate) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col gap-2 px-3">
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
          <ShareBaseDialog />
          <MoreMenu />
        </ul>
      </div>
    </>
  );
};
