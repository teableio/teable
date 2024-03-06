import { Home } from '@teable/icons';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { SpaceList } from './SpaceList';

export const SpaceSideBar = () => {
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const pageRoutes: {
    href: string;
    text: string;
    Icon: React.FC<{ className?: string }>;
  }[] = [
    {
      href: '/space',
      text: t('space:allSpaces'),
      Icon: Home,
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-2 px-3">
        <ul>
          {pageRoutes.map(({ href, text, Icon }) => {
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
      <SpaceList />
    </>
  );
};
