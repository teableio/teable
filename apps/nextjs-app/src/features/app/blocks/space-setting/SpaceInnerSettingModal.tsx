import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { Settings, Users } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { Collaborator } from './collaborator';
import { General } from './general';

interface ISpaceInnerSettingModalProps {
  children: React.ReactNode;
  spaceId: string;
}

enum SettingTab {
  General = 'general',
  Collaborator = 'collaborator',
}

export const SpaceInnerSettingModal = (props: ISpaceInnerSettingModalProps) => {
  const { children, spaceId } = props;

  const { t } = useTranslation(['common', 'space']);

  const [open, setOpen] = useState(false);

  const [tab, setTab] = useState(SettingTab.General);
  const tabList = useMemo(() => {
    return [
      {
        key: SettingTab.General,
        name: t('space:spaceSetting.general'),
        Icon: Settings,
      },
      {
        key: SettingTab.Collaborator,
        name: t('space:spaceSetting.collaborators'),
        Icon: Users,
      },
    ];
  }, [t]);

  const content = (
    <Tabs
      defaultValue={SettingTab.General}
      value={tab}
      onValueChange={(value) => setTab(value as SettingTab)}
      className="flex h-full gap-0 overflow-hidden"
    >
      <TabsList className="flex h-full w-[200px] flex-col items-start justify-start gap-1 rounded-none border-none bg-muted p-4">
        {tabList.map(({ key, name, Icon }) => {
          return (
            <TabsTrigger
              key={key}
              value={key}
              className="h-8 w-full cursor-pointer justify-start gap-2 rounded-md font-normal data-[state=active]:bg-surface data-[state=active]:font-medium data-[state=active]:shadow-none hover:bg-surface"
            >
              <Icon className="size-5 shrink-0 sm:size-4" />
              <span className="hidden sm:inline">{name}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.General}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <General spaceId={spaceId} />
      </TabsContent>
      <TabsContent
        tabIndex={-1}
        value={SettingTab.Collaborator}
        className="mt-0 size-full overflow-y-auto overflow-x-hidden"
      >
        <Collaborator spaceId={spaceId} />
      </TabsContent>
    </Tabs>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[85%] max-h-[85%] max-w-[80%] flex-col gap-0 p-0 transition-[max-width] duration-300">
        {content}
      </DialogContent>
    </Dialog>
  );
};
