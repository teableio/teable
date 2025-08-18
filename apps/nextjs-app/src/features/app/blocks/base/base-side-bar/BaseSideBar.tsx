import { Gauge, Lock, MoreHorizontal, Settings, Trash2 } from '@teable/icons';
import { useBasePermission } from '@teable/sdk/hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { Bot } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { tableConfig } from '@/features/i18n/table.config';
import { MoveBaseSelectPanel } from '../../table-list/MoveBasePanel';
import { TableList } from '../../table-list/TableList';
import { QuickAction } from './QuickAction';
import { useBaseSideBarStore } from './store';

export const BaseSideBar = () => {
  const router = useRouter();
  const { baseId } = router.query;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const basePermission = useBasePermission();
  const usage = useBaseUsage();
  const { moveBaseOpen, setMoveBaseOpen } = useBaseSideBarStore();

  const { automationEnable = true, advancedPermissionsEnable = true } = usage?.limit ?? {};

  const pageRoutes: {
    href: string;
    label: string;
    Icon: React.FC<{ className?: string }>;
    disabled?: boolean;
  }[] = useMemo(
    () =>
      [
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
          disabled: !automationEnable,
        },
        {
          href: `/base/${baseId}/authority-matrix`,
          label: t('common:noun.authorityMatrix'),
          Icon: Lock,
          hidden: !basePermission?.['base|authority_matrix_config'],
          disabled: !advancedPermissionsEnable,
        },
      ].filter((item) => !item.hidden),
    [advancedPermissionsEnable, automationEnable, baseId, basePermission, t]
  );

  return (
    <>
      <div className="flex flex-col gap-2 px-3">
        <div>
          <QuickAction>{t('common:quickAction.title')}</QuickAction>
        </div>
        <ul>
          {pageRoutes.map(({ href, label, Icon, disabled }) => {
            return (
              <li key={href}>
                {disabled ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          className="my-[2px] w-full cursor-not-allowed justify-start text-sm font-normal text-gray-500 hover:bg-background hover:text-gray-500"
                          variant="ghost"
                          size="xs"
                          asChild
                          disabled
                        >
                          <div className="flex">
                            <Icon className="size-4 shrink-0" />
                            <p className="truncate">{label}</p>
                            <div className="grow basis-0"></div>
                          </div>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('billing.unavailableInPlanTips')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
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
                    </Link>
                  </Button>
                )}
              </li>
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
      <MoveBaseSelectPanel open={moveBaseOpen} onOpenChange={setMoveBaseOpen} />
    </>
  );
};
