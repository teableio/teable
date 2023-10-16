import { ArrowUpRight, Code2, Component, Database, Share2 } from '@teable-group/icons';
import { useDriver } from '@teable-group/sdk/hooks';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn';
import Link from 'next/link';
import { useGraphStore } from '../graph/useGraphStore';

export const Others: React.FC = () => {
  const { toggleGraph } = useGraphStore();
  const driver = useDriver();
  return (
    <div className="flex">
      <Button variant={'ghost'} size={'xs'} className="font-normal">
        <ArrowUpRight className="h-4 w-4" />
        Share
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant={'ghost'} size={'xs'} className="font-normal">
            <Component className="h-4 w-4" />
            Extensions
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-40 p-0">
          <Button
            variant={'ghost'}
            size={'xs'}
            className="w-full justify-start font-normal"
            onClick={() => toggleGraph()}
          >
            <Share2 className="pr-1 text-lg" />
            Graph
          </Button>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant={'ghost'} size={'xs'} className="font-normal">
            <Code2 className="h-4 w-4" />
            API
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-48 p-0">
          <Button
            variant={'ghost'}
            size={'xs'}
            className="w-full justify-start font-normal"
            asChild
          >
            <Link href="/docs" target="_blank">
              <Code2 className="h-4 w-4" />
              Restful API
            </Link>
          </Button>
          <Button variant={'ghost'} size={'xs'} className="w-full justify-start font-normal">
            <Database className="pr-1 text-lg" />
            <span className="capitalize">{driver}</span>Connection
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};
