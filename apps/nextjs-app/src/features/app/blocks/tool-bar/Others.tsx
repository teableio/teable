import { ArrowUpRight, Code2, Component, Share2 } from '@teable-group/icons';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn';
import Link from 'next/link';
import { useGraphStore } from '../graph/useGraphStore';

export const Others: React.FC = () => {
  const { toggleGraph } = useGraphStore();
  return (
    <div className="flex">
      <Button variant={'ghost'} size={'xs'} className="font-normal">
        <ArrowUpRight className="w-4 h-4" />
        Share
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant={'ghost'} size={'xs'} className="font-normal">
            <Component className="w-4 h-4" />
            Extensions
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-40 p-0">
          <div>
            <Button
              variant={'ghost'}
              size={'xs'}
              className="font-normal w-full justify-start"
              onClick={() => toggleGraph()}
            >
              <Share2 className="text-lg pr-1" />
              Graph
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant={'ghost'} size={'xs'} className="font-normal" asChild>
        <Link href="/docs" target="_blank">
          <Code2 className="w-4 h-4" />
          API
        </Link>
      </Button>
    </div>
  );
};
