import { Database, Home, Trash2, ShieldUser } from '@teable/icons';
import { useSession } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { PinList } from './PinList';
import { SpaceList } from './SpaceList';

export const SpaceSideBar = (props: { isAdmin?: boolean | null }) => {
  const { isAdmin } = props;
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { user } = useSession();
  const organization = user?.organization;

  const pageRoutes: {
    href: string;
    text: string;
    Icon: React.FC<{ className?: string }>;
    hidden?: boolean;
  }[] = [
    {
      href: '/space',
      text: t('space:allSpaces'),
      Icon: Home,
    },
    {
      href: '/space/shared-base',
      text: t('space:sharedBase.title'),
      Icon: Database,
    },
    {
      href: `/enterprise/${organization?.id}`,
      text: t('noun.organizationPanel'),
      Icon: Building2,
      hidden: !organization?.isAdmin,
    },
    {
      href: '/admin/setting',
      text: t('noun.adminPanel'),
      Icon: ShieldUser,
      hidden: !isAdmin,
    },
    {
      href: '/space/trash',
      text: t('noun.trash'),
      Icon: Trash2,
    },
  ];
  return (
    <>
      <div className="flex flex-col gap-2 px-3">
        <ul>
          {pageRoutes.map(({ href, text, Icon, hidden }) => {
            if (hidden) return null;
            return (
              <li key={href}>
                <Button
                  variant="ghost"
                  size={'xs'}
                  asChild
                  className={cn(
                    'w-full justify-start text-sm px-2 my-[2px]',
                    href === router.pathname && 'bg-accent'
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PinList className="max-h-[30vh] flex-none" />
        <SpaceList />
      </div>
    </>
  );
};
