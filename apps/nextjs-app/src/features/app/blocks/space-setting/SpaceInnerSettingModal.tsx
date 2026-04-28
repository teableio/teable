import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { useCallback, useEffect, useState } from 'react';
import {
  UnifiedSettingDialogContent,
  type UnifiedSettingTab,
} from '@/features/app/components/setting/UnifiedSettingDialogContent';
import { SpaceSettingTab } from './types';

interface ISpaceInnerSettingModalProps {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  defaultTab?: SpaceSettingTab;
  children: React.ReactNode;
}

export { SpaceSettingTab as SettingTab };

export const SpaceInnerSettingModal = (props: ISpaceInnerSettingModalProps) => {
  const {
    children,
    open: controlledOpen,
    setOpen: controlledSetOpen,
    defaultTab = SpaceSettingTab.General,
  } = props;

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (controlledSetOpen) {
        controlledSetOpen(value);
      }
      if (!isControlled) {
        setInternalOpen(value);
      }
    },
    [controlledSetOpen, isControlled, setInternalOpen]
  );

  const [tab, setTab] = useState<UnifiedSettingTab>(defaultTab);

  useEffect(() => {
    if (open) {
      setTab(defaultTab);
    }
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="flex h-[85%] max-h-[85%] max-w-[80%] flex-col gap-0 p-0 transition-[max-width] duration-300"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <UnifiedSettingDialogContent
          tab={tab}
          onTabChange={setTab}
          entry="space"
          defaultTab={defaultTab}
        />
      </DialogContent>
    </Dialog>
  );
};
