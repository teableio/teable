import { Button, Separator, cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { type FC, Fragment } from 'react';
import { spaceSettingNavConfig } from '@/features/system/dynamic-routes/space-setting-nav.config';

export const SpaceSettingSideBar: FC = () => {
  const router = useRouter();
  const { spaceId } = router.query as { spaceId: string };

  const nav = spaceSettingNavConfig(spaceId);
  return (
    <div className="w-80 md:flex">
      <div className="flex-1 py-4">
        {Object.entries(nav).map(([group, items], index) => (
          <Fragment key={index}>
            <div className="space-y-1">
              <div className="flex items-center justify-start pl-4 pt-2">
                <h2 className="text-sm text-muted-foreground">{group}</h2>
              </div>
              <ul>
                {items.map(({ text, href, icon: Icon }) => (
                  <li key={text}>
                    <Button
                      asChild
                      variant="ghost"
                      className={cn(
                        'w-full justify-start space-x-2',
                        href === router.asPath && 'bg-secondary'
                      )}
                    >
                      <Link href={href} className="font-normal">
                        <Icon className="size-4 shrink-0" />
                        {text}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            {index < Object.entries(nav).length - 1 && <Separator className="my-2" />}
          </Fragment>
        ))}
      </div>
    </div>
  );
};
