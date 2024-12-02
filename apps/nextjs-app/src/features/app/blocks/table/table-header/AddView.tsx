import { ViewType, getUniqName } from '@teable/core';
import { Plus } from '@teable/icons';
import { useViews } from '@teable/sdk';
import { useTablePermission } from '@teable/sdk/hooks';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { GUIDE_CREATE_VIEW } from '@/components/Guide';
import { VIEW_ICON_MAP } from '../../view/constant';
import { useAddView } from '../../view/list/useAddView';
import { AddPluginView } from './AddPluginView';

export const AddView: React.FC = () => {
  const addView = useAddView();
  const views = useViews();
  const permission = useTablePermission();
  const [isOpen, setOpen] = useState(false);
  const { t } = useTranslation('table');

  const closePopover = useCallback(() => {
    setOpen(false);
  }, []);

  const viewInfoList = [
    {
      name: t('view.category.table'),
      type: ViewType.Grid,
      Icon: VIEW_ICON_MAP[ViewType.Grid],
    },
    {
      name: t('view.category.gallery'),
      type: ViewType.Gallery,
      Icon: VIEW_ICON_MAP[ViewType.Gallery],
    },
    {
      name: t('view.category.kanban'),
      type: ViewType.Kanban,
      Icon: VIEW_ICON_MAP[ViewType.Kanban],
    },
    {
      name: t('view.category.calendar'),
      type: ViewType.Calendar,
      Icon: VIEW_ICON_MAP[ViewType.Calendar],
    },
    {
      name: t('view.category.form'),
      type: ViewType.Form,
      Icon: VIEW_ICON_MAP[ViewType.Form],
    },
  ];

  const onClick = (type: ViewType, name: string) => {
    const uniqueName = getUniqName(
      name.split(' ')[0],
      views?.map((view) => view.name)
    );
    addView(type, uniqueName);
    setOpen(false);
  };

  if (!permission['view|create']) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className={cn(GUIDE_CREATE_VIEW, 'size-7 shrink-0 px-0')}
          size={'xs'}
          variant={'outline'}
        >
          <Plus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-36 p-1">
        {viewInfoList.map((item) => {
          const { name, type, Icon } = item;
          return (
            <Button
              key={type}
              variant={'ghost'}
              size={'xs'}
              className="w-full justify-start font-normal"
              onClick={() => onClick(type, name)}
            >
              <Icon className="pr-1 text-lg" />
              {name}
            </Button>
          );
        })}
        <Separator />
        <AddPluginView onClose={closePopover} />
      </PopoverContent>
    </Popover>
  );
};
