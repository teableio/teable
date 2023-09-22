import { ChevronDown, Menu as MenuIcon } from '@teable-group/icons';
import {
  Switch,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@teable-group/ui-lib';
import { Toggle } from '@teable-group/ui-lib/shadcn/ui/toggle';
import { useContext } from 'react';
import { autoMationContext } from '../context';
import { WorkFlow } from './workflow';

const WorkFlowPanel = () => {
  const context = useContext(autoMationContext);
  const { menuVisible, toggleMenu } = context;
  return (
    <div className="flex flex-1 h-full flex-col">
      <header className="border-b p-2 flex justify-between items-center min-w-max h-12">
        <div className="flex items-center">
          {!menuVisible && (
            <Toggle onClick={() => toggleMenu(!menuVisible)} className="mr-2">
              <MenuIcon className="h-4 w-4" />
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
      <div className="overflow-auto bg-secondary flex flex-1 items-center justify-center">
        <WorkFlow></WorkFlow>
      </div>
    </div>
  );
};

export { WorkFlowPanel };
