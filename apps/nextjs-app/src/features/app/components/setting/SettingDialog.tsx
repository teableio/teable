import { Dialog, DialogContent } from '@teable/ui-lib/shadcn';
import { UnifiedSettingDialogContent } from './UnifiedSettingDialogContent';
import { PersonalSettingTab, useSettingStore } from './useSettingStore';

export interface ISettingDialogProps {
  spaceId?: string;
  includeSpaceSettings?: boolean;
}

export const SettingDialog = ({ spaceId, includeSpaceSettings = true }: ISettingDialogProps) => {
  const { open, setOpen, tab, setTab } = useSettingStore();
  const activeTab = tab ?? PersonalSettingTab.Profile;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:h-4/5 sm:max-h-[80vh] sm:max-w-6xl sm:rounded-lg sm:border sm:shadow-lg [&>button]:end-4 [&>button]:top-4"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <UnifiedSettingDialogContent
          tab={activeTab}
          onTabChange={setTab}
          entry="personal"
          defaultTab={PersonalSettingTab.Profile}
          spaceId={spaceId}
          includeSpaceSettings={includeSpaceSettings}
        />
      </DialogContent>
    </Dialog>
  );
};
