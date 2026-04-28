import { useIsTouchDevice } from '@teable/sdk/hooks';
import { Dialog, DialogContent, Sheet, SheetContent } from '@teable/ui-lib/shadcn';
import { UnifiedSettingDialogContent } from './UnifiedSettingDialogContent';
import { SettingTab, useSettingStore } from './useSettingStore';

export interface ISettingDialogProps {
  spaceId?: string;
  includeSpaceSettings?: boolean;
}

export const SettingDialog = ({ spaceId, includeSpaceSettings = true }: ISettingDialogProps) => {
  const isTouchDevice = useIsTouchDevice();
  const { open, setOpen, tab, setTab } = useSettingStore();
  const activeTab = tab ?? SettingTab.Profile;

  return (
    <>
      {isTouchDevice ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            className="h-5/6 rounded-t-lg px-1 pb-0 pt-4 [&>button]:right-4 [&>button]:top-4 "
            side="bottom"
          >
            <UnifiedSettingDialogContent
              tab={activeTab}
              onTabChange={setTab}
              entry="personal"
              defaultTab={SettingTab.Profile}
              spaceId={spaceId}
              includeSpaceSettings={includeSpaceSettings}
            />
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="h-4/5 max-h-[80vh] max-w-6xl overflow-hidden p-0 [&>button]:right-4 [&>button]:top-4 "
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <UnifiedSettingDialogContent
              tab={activeTab}
              onTabChange={setTab}
              entry="personal"
              defaultTab={SettingTab.Profile}
              spaceId={spaceId}
              includeSpaceSettings={includeSpaceSettings}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
