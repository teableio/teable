import type { IWorkFlowItem, IWorkflowSection } from '@teable-group/core';
import { getRandomString } from '@teable-group/core';
import { Menu as MenuIcon, Plus, Sheet, Network } from '@teable-group/icons';
import { Button, Separator } from '@teable-group/ui-lib';
import { Toggle } from '@teable-group/ui-lib/shadcn/ui/toggle';
import classnames from 'classnames';
import { useRouter } from 'next/router';
import { useContext, useEffect } from 'react';
import { autoMationContext } from '../context';
import { DefaultMenu } from './DefaultMenu';
import { SortableWorkflow } from './sortable-workflow/SortableWorkflow';

const Menu = () => {
  const { menuData, setMenuData } = useContext(autoMationContext);
  const context = useContext(autoMationContext);
  const router = useRouter();
  const { baseId, automationId } = router.query;
  const { menuVisible, toggleMenu } = context;

  const createSection = () => {
    const newList = [...menuData];
    newList.push({
      id: getRandomString(10),
      name: 'New Section',
      workflowOrder: [],
    } as unknown as IWorkflowSection[number]);

    setMenuData(newList);
  };
  const createAction = () => {
    const newList = [...menuData];
    if (!newList.length) {
      createSection();
      return;
    }
    newList[0].workflowOrder.push({
      id: getRandomString(10),
      name: 'New Action',
    } as IWorkFlowItem);

    setMenuData(newList);
  };

  useEffect(() => {
    if (menuData.length && !automationId) {
      const defaultSectionId = menuData[0].workflowOrder[0].id;
      router.push(
        {
          pathname: '/base/[baseId]/automation/[automationId]',
          query: { baseId, automationId: defaultSectionId },
        },
        undefined,
        { shallow: true }
      );
    }
  }, [automationId, baseId, menuData, router]);

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

      {menuData.length ? (
        <div className="flex h-full flex-col justify-between overflow-hidden">
          <SortableWorkflow></SortableWorkflow>
          <div className="flex min-h-fit shrink-0 flex-col p-3">
            <Separator className="my-3" />
            <span className="pl-1 text-muted-foreground/50">Create...</span>
            <Button
              variant="ghost"
              className="flex justify-between p-1"
              onClick={() => createAction()}
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
              onClick={() => createSection()}
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
