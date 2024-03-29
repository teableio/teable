import { ArrowUpRight, Code2, Component, Database, Share2 } from '@teable/icons';
import { useDriver } from '@teable/sdk/hooks';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { GUIDE_API_BUTTON } from '@/components/Guide';
import { DbConnectionPanelTrigger } from '../../db-connection/PanelTrigger';
import { useCellGraphStore } from '../../graph/useCellGraphStore';
import { SharePopover } from './SharePopover';
import { ToolBarButton } from './ToolBarButton';

export const Others: React.FC = () => {
  const { toggleGraph } = useCellGraphStore();
  const driver = useDriver();
  return (
    <div className="min-w-[100px] justify-end @container/toolbar-others @2xl/toolbar:flex @2xl/toolbar:flex-1">
      <SharePopover>
        {(text, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            textClassName="@[234px]/toolbar-others:inline"
          >
            <ArrowUpRight className="size-4" />
          </ToolBarButton>
        )}
      </SharePopover>

      <Popover>
        <PopoverTrigger asChild>
          <ToolBarButton text="Extensions" textClassName="@[234px]/toolbar-others:inline">
            <Component className="size-4" />
          </ToolBarButton>
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
          <ToolBarButton
            text="API"
            className={GUIDE_API_BUTTON}
            textClassName="@[234px]/toolbar-others:inline"
          >
            <Code2 className="size-4" />
          </ToolBarButton>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-48 p-0">
          <Button
            variant={'ghost'}
            size={'xs'}
            className="w-full justify-start font-normal"
            asChild
          >
            <Link href="/docs" target="_blank">
              <Code2 className="size-4" />
              Restful API
            </Link>
          </Button>
          <DbConnectionPanelTrigger>
            <Button variant={'ghost'} size={'xs'} className="w-full justify-start font-normal">
              <Database className="pr-1 text-lg" />
              <span className="capitalize">{driver}</span>Connection
            </Button>
          </DbConnectionPanelTrigger>
        </PopoverContent>
      </Popover>
    </div>
  );
};
