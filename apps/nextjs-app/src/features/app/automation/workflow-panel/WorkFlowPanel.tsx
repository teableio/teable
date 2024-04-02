import { ChevronDown, Menu as MenuIcon } from '@teable/icons';
import {
  Switch,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@teable/ui-lib';
import { Toggle } from '@teable/ui-lib/shadcn/ui/toggle';
import { useContext } from 'react';
import { autoMationContext } from '../context';
import { WorkFlow } from './workflow';

const WorkFlowPanel = () => {
  const context = useContext(autoMationContext);
  const { menuVisible, toggleMenu } = context;
  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex h-12 min-w-max items-center justify-between border-b p-2">
        <div className="flex items-center">
          {!menuVisible && (
            <Toggle onClick={() => toggleMenu(!menuVisible)} className="mr-2">
              <MenuIcon className="size-4" />
              <span className="truncate">Automations List</span>
            </Toggle>
          )}
          <Switch></Switch>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-2">
                title
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Rename automation</DropdownMenuItem>
              <DropdownMenuItem>Edit description</DropdownMenuItem>
              <DropdownMenuItem>Copy automation URL</DropdownMenuItem>
              <DropdownMenuItem>Duplication automation</DropdownMenuItem>
              <DropdownMenuItem>Delete automation</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div>
          <Button variant="outline">Run History</Button>
          <Button variant="outline" className="ml-2">
            Test Automation
          </Button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-secondary">
        <WorkFlow></WorkFlow>
      </div>
    </div>
  );
};

export { WorkFlowPanel };
