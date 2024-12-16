import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/router';

export interface ISidebarContentRoute {
  Icon: React.FC<{ className?: string }>;
  label: string | React.ReactNode;
  route: string;
  pathTo: string;
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
      {title && <span className="text-sm text-slate-500">{title}</span>}
      <ul>
        {routes.map(({ Icon, label, route, pathTo, disabledTip }) => {
          return (
            <li key={route}>
              {disabledTip ? (
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
                      <p>{disabledTip}</p>
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
                    route === router.pathname && 'bg-secondary'
                  )}
                >
                  <Link href={pathTo} className="font-normal">
                    <Icon className="size-4 shrink-0" />
                    <p className="truncate">{label}</p>
                    <div className="grow basis-0"></div>
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
