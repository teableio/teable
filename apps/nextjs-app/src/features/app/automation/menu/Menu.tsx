import { Menu as MenuIcon, Plus, Sheet, Network } from '@teable-group/icons';
import { Button, Separator } from '@teable-group/ui-lib';
import { Toggle } from '@teable-group/ui-lib/shadcn/ui/toggle';
import classnames from 'classnames';
import { useState, useContext } from 'react';
import { autoMationContext } from '../context';
import { DragSections } from './DragSections';

// interface IMenuProps {
//   onChange?: () => void;
//   list?: [];
// }

const Menu = () => {
  // const { list = [1, 2, 3, 4, 5, 11, 6, 7, 8, 9] } = props;
  const [list, setList] = useState<string[]>([]);
  const context = useContext(autoMationContext);
  const { menuVisible, toggleMenu } = context;

  return (
    <div
      className={classnames(
        'min-w-[250px] max-w-lg h-full flex flex-col flex-1',
        !menuVisible ? 'hidden' : ''
      )}
    >
      <header className="p-2 border-secondary border-b h-12 flex items-center">
        <Toggle onClick={() => toggleMenu(!menuVisible)} pressed={menuVisible}>
          <MenuIcon className="h-4 w-4" />
          <span className="truncate">Automations List</span>
        </Toggle>
      </header>

      <div className="flex flex-col justify-between h-full overflow-hidden">
        <div className="rounded overflow-auto flex-1 h-full p-2">
          <DragSections></DragSections>
        </div>

        <div className="flex flex-col shrink-0 min-h-fit p-3">
          <Separator className="my-3" />
          <span className="text-muted-foreground/50 pl-1">Create...</span>
          <Button variant="ghost" className="flex justify-between p-1">
            <div className="flex items-center">
              <Network />
              <span className="ml-1">Create automation</span>
            </div>
            <Plus />
          </Button>
          <Button
            variant="ghost"
            className="flex justify-between p-1"
            onClick={() => {
              setList([...list, '1']);
            }}
          >
            <div className="flex items-center">
              <Sheet />
              <span className="ml-1">Create section</span>
            </div>
            <Plus />
          </Button>
        </div>
      </div>
    </div>
  );
};

export { Menu };
