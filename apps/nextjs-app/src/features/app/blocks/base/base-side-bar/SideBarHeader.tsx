/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useQuery } from '@tanstack/react-query';
import { ChevronsLeft, TeableNew, Sidebar } from '@teable-group/icons';
import { getBaseById } from '@teable-group/openapi';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Button,
} from '@teable-group/ui-lib';
import { useRouter } from 'next/router';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import type { ISideBarInteractionProps } from './SideBar';

export const SideBarHeader = (props: ISideBarInteractionProps) => {
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const { expandSideBar } = props;
  const { data } = useQuery({
    queryKey: ['base', baseId],
    queryFn: ({ queryKey }) => getBaseById(queryKey[1]),
  });

  const backSpace = () => {
    router.push({
      pathname: '/space',
    });
  };

  return (
    <div className="group/header m-2 flex items-center gap-1">
      <div className="group relative h-6 w-6 shrink-0 cursor-pointer" onClick={backSpace}>
        <div className="absolute top-0 h-6 w-6 group-hover:opacity-0">
          {data?.data.icon ? (
            <Emoji emoji={data.data.icon} size={'1.5rem'} />
          ) : (
            <TeableNew className="h-6 w-6 text-black" />
          )}
        </div>
        <ChevronsLeft className="absolute top-0 h-6 w-6 opacity-0 group-hover:opacity-100" />
      </div>
      <p className="truncate text-sm">{data?.data.name}</p>
      <div className="grow basis-0"></div>

      {expandSideBar && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="xs" onClick={() => expandSideBar?.()}>
                <Sidebar className="h-5 w-5"></Sidebar>
              </Button>
            </TooltipTrigger>
            <TooltipContent hideWhenDetached={true}>
              <p>Collapse SideBar ⌘+B</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};
