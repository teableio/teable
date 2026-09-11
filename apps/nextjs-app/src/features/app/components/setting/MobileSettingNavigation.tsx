import { cn } from '@teable/ui-lib/shadcn';
import { ChevronDown } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { createContext, useContext } from 'react';

interface IMobileSettingNavigationContext {
  open: boolean;
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
}

const MobileSettingNavigationContext = createContext<IMobileSettingNavigationContext | null>(null);

export const MobileSettingNavigationProvider = MobileSettingNavigationContext.Provider;

export const MobileSettingNavigationTitle = ({
  children,
  enabled = true,
  className,
}: {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
}) => {
  const navigation = useContext(MobileSettingNavigationContext);

  if (!navigation || !enabled) {
    return children;
  }

  return (
    <>
      <span className="hidden sm:inline">{children}</span>
      <button
        ref={navigation.triggerRef}
        type="button"
        aria-expanded={navigation.open}
        aria-haspopup="dialog"
        className={cn(
          '-ms-1 inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:hidden',
          className
        )}
        onClick={navigation.onOpen}
      >
        <span className="truncate">{children}</span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', navigation.open && 'rotate-180')}
        />
      </button>
    </>
  );
};
