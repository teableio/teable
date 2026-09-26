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
  defaultTab?: UnifiedSettingTab;
  children: React.ReactNode;
}

export { SpaceSettingTab };

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
        className="flex h-dvh max-h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none transition-[max-width] duration-300 sm:h-[85%] sm:max-h-[85%] sm:max-w-[80%] sm:rounded-lg sm:border"
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
