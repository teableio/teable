import { Menu as MenuIcon, Plus, Sheet, Network } from '@teable-group/icons';
import { Button, Separator } from '@teable-group/ui-lib';
import { Toggle } from '@teable-group/ui-lib/shadcn/ui/toggle';
import classnames from 'classnames';
import { useState, useContext } from 'react';
import { autoMationContext } from '../context';
import { DefaultMenu } from './DefaultMenu';
import { SortableWorkflow } from './sortable-workflow/SortableWorkflow';

const Menu = () => {
  const [list, setList] = useState([
    {
      key: 'Section 1',
      list: [{ key: '1-1' }, { key: '1-2' }, { key: '1-3' }],
    },
    {
      key: 'Section 2',
      list: [{ key: '2-1' }],
    },
    {
      key: 'Section 3',
      list: [{ key: '3-1' }],
    },
    {
      key: 'more',
      list: [{ key: '4-1' }, { key: '4-2' }],
    },
  ]);
  const context = useContext(autoMationContext);
  const { menuVisible, toggleMenu } = context;

  return (
    <div
      className={classnames(
        'flex h-full min-w-[250px] max-w-lg flex-1 flex-col',
        !menuVisible ? 'hidden' : ''
      )}
    >
      <header className="flex h-12 items-center border-b border-secondary p-2">
        <Toggle onClick={() => toggleMenu(!menuVisible)} pressed={menuVisible}>
          <MenuIcon className="h-4 w-4" />
          <span className="truncate">Automation List</span>
        </Toggle>
      </header>

      {list.length ? (
        <div className="flex h-full flex-col justify-between overflow-hidden">
          <SortableWorkflow></SortableWorkflow>
          <div className="flex min-h-fit shrink-0 flex-col p-3">
            <Separator className="my-3" />
            <span className="pl-1 text-muted-foreground/50">Create...</span>
            <Button
              variant="ghost"
              className="flex justify-between p-1"
              onClick={() => {
                const newList = [...list];
                newList[newList.length - 1].list.push({
                  key: '' + Math.random() * 1000,
                });
                setList(newList);
              }}
            >
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
                const newList = [...list];
                newList.push({
                  key: '' + Math.random() * 10000,
                  list: [],
                });
                setList(newList);
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
      ) : (
        <DefaultMenu></DefaultMenu>
      )}
    </div>
  );
};

export { Menu };
