import type { BillingProductLevel } from '@teable/openapi';
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { UpgradeWrapper } from '../billing/UpgradeWrapper';

export interface ISidebarContentRoute {
  Icon: React.FC<{ className?: string }> | LucideIcon;
  label: string | React.ReactNode;
  route: string;
  pathTo: string;
  billingLevel?: BillingProductLevel;
  disabledTip?: string;
}

interface ISidebarContentProps {
  className?: string;
  title?: string;
  routes: ISidebarContentRoute[];
}

export const SidebarContent = (props: ISidebarContentProps) => {
  const { title, routes, className } = props;
  const router = useRouter();

  return (
    <div className={cn('flex flex-col gap-2 border-t px-4 py-2', className)}>
      {title && <span className="text-sm text-muted-foreground">{title}</span>}
      <ul>
        {routes.map(({ Icon, label, route, pathTo, billingLevel, disabledTip }) => {
          const itemContent = (badge: React.ReactNode) => (
            <>
              <Icon className="size-4 shrink-0" />
              <p className="truncate">{label}</p>
              <div className="grow basis-0"></div>
              {badge}
            </>
          );

          return (
            <UpgradeWrapper
              key={route}
              spaceId={router.query.spaceId as string}
              targetBillingLevel={billingLevel}
            >
              {({ badge }) => (
                <li>
                  {disabledTip ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="xs"
                            aria-disabled
                            onClick={(event) => event.preventDefault()}
                            className="my-[2px] w-full cursor-not-allowed justify-start text-sm font-normal opacity-50"
                          >
                            {itemContent(badge)}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent hideWhenDetached={true}>{disabledTip}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      asChild
                      className={cn(
                        'w-full justify-start text-sm my-[2px]',
                        route === router.pathname && 'bg-accent'
                      )}
                    >
                      <Link href={pathTo} className="font-normal">
                        {itemContent(badge)}
                      </Link>
                    </Button>
                  )}
                </li>
              )}
            </UpgradeWrapper>
          );
        })}
      </ul>
    </div>
  );
};
