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
import { spaceConfig } from '@/features/i18n/space.config';
import { CollaboratorPage } from './collaborator';
import { GeneralPage } from './general';

interface ISpaceInnerSettingModalProps {
  children: React.ReactNode;
}

enum SettingTab {
  General = 'general',
  Collaborator = 'collaborator',
}

export const SpaceInnerSettingModal = (props: ISpaceInnerSettingModalProps) => {
  const { children } = props;

  const { t } = useTranslation(spaceConfig.i18nNamespaces);

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
      <TabsList className="flex h-full w-72 flex-col items-start justify-start gap-1 rounded-none border-none bg-muted p-4">
        {tabList.map(({ key, name, Icon }) => {
          return (
            <TabsTrigger
              key={key}
              value={key}
              className="h-8 w-full cursor-pointer justify-start gap-2 rounded-md font-normal data-[state=active]:bg-surface data-[state=active]:font-medium data-[state=active]:shadow-none hover:bg-surface"
            >
              <Icon className="size-4 shrink-0" />
              <span>{name}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent tabIndex={-1} value={SettingTab.General} className="mt-0 size-full">
        <GeneralPage />
      </TabsContent>
      <TabsContent tabIndex={-1} value={SettingTab.Collaborator} className="mt-0 size-full">
        <CollaboratorPage />
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
