import { ArrowUpRight, Code2, Component } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';
import { useGraphStore } from '../graph/useGraphStore';

export const Others: React.FC = () => {
  const { toggleGraph } = useGraphStore();
  return (
    <div className="flex">
      <Button variant={'ghost'} size={'xs'} className="font-normal" onClick={toggleGraph}>
        <Component className="w-4 h-4" />
        Graph
      </Button>
      <Button variant={'ghost'} size={'xs'} className="font-normal">
        <ArrowUpRight className="w-4 h-4" />
        Share
      </Button>
      <Button variant={'ghost'} size={'xs'} className="font-normal">
        <Component className="w-4 h-4" />
        Extensions
      </Button>
      <Button variant={'ghost'} size={'xs'} className="font-normal">
        <Code2 className="w-4 h-4" />
        API
      </Button>
    </div>
  );
};
