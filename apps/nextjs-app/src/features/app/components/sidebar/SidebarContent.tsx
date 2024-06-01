import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/router';

export interface ISidebarContentRoute {
  Icon: React.FC<{ className?: string }>;
  label: string;
  route: string;
  pathTo: string;
}

interface ISidebarContentProps {
  title?: string;
  routes: ISidebarContentRoute[];
}

export const SidebarContent = (props: ISidebarContentProps) => {
  const { title, routes } = props;
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2 border-t px-4 py-2">
      {title && <span className="text-sm text-slate-500">{title}</span>}
      <ul>
        {routes.map(({ Icon, label, route, pathTo }) => {
          return (
            <li key={route}>
              <Button
                variant="ghost"
                size={'xs'}
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
            </li>
          );
        })}
      </ul>
    </div>
  );
};
