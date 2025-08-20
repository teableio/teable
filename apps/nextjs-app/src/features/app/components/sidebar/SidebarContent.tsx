import type { BillingProductLevel } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { UpgradeWrapper } from '../billing/UpgradeWrapper';

export interface ISidebarContentRoute {
  Icon: React.FC<{ className?: string }>;
  label: string | React.ReactNode;
  route: string;
  pathTo: string;
  billingLevel?: BillingProductLevel;
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
      {title && <span className="text-sm text-slate-500">{title}</span>}
      <ul>
        {routes.map(({ Icon, label, route, pathTo, billingLevel }) => {
          return (
            <UpgradeWrapper
              key={route}
              spaceId={router.query.spaceId as string}
              targetBillingLevel={billingLevel}
            >
              {({ badge }) => (
                <li>
                  <Button
                    variant="ghost"
                    size="xs"
                    asChild
                    className={cn(
                      'w-full justify-start text-sm my-[2px]',
                      route === router.pathname && 'bg-secondary'
                    )}
                  >
                    <Link href={pathTo} className="font-normal">
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
      </ul>
    </div>
  );
};
