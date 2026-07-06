'use client';

import { useTheme } from '@teable/next-themes';
import type { ExternalToast, ToastT } from 'sonner';
import { Toaster as Sonner, toast as sonnerToast } from 'sonner';
import { cn } from '../utils';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      richColors
      className={cn('toaster group pointer-events-auto')}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-popover group-[.toaster]:text-foreground group-[.toaster]:border-border-high group-[.toaster]:shadow-lg min-w-0 items-start [&>[data-close-button]~*:not([data-icon]):not([data-button])]:min-w-0 [&>[data-close-button]~*:not([data-icon]):not([data-button])]:flex-1 [&>[data-close-button]~*:not([data-icon]):not([data-button])]:overflow-x-hidden [&:has([data-description])]:grid [&:has([data-description])]:grid-cols-[auto_1fr_auto] [&:has([data-description])]:gap-x-2 [&:has([data-description])]:gap-y-1 [&:has([data-description]):has([data-action]):has([data-cancel])]:grid-cols-[auto_1fr_auto_auto]',
          title:
            'min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] [.toast:has([data-description])_&]:col-start-1 [.toast:has([data-description])_&]:col-end-2 [.toast:has([data-description])_&]:row-start-1 [.toast:has([data-description])_&]:self-center [.toast:has([data-description]):has([data-icon])_&]:col-start-2 [.toast:has([data-description]):has([data-icon])_&]:col-end-3',
          description:
            'min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] group-[.toast]:text-muted-foreground [.toast:has([data-description])_&]:col-span-full [.toast:has([data-description])_&]:row-start-2 [.toast:has([data-description])_&]:max-h-[120px] [.toast:has([data-description])_&]:overflow-y-auto [.toast:has([data-description])_&]:scrollbar [.toast:has([data-description])_&]:scrollbar-thumb-foreground/40 [.toast:has([data-description])_&]:scrollbar-thumb-rounded-md [.toast:has([data-description])_&]:scrollbar-w-[4px] [.toast:has([data-description])_&]:will-change-transform [.toast:has([data-icon])_&]:pl-7',
          actionButton:
            '!-my-1 !h-7 !rounded-md self-center [background:hsl(var(--primary))!important] [color:hsl(var(--primary-foreground))!important] hover:[background:hsl(var(--primary)/0.9)!important] [.toast:has([data-description])_&]:!my-0 [.toast:has([data-description])_&]:col-start-3 [.toast:has([data-description])_&]:col-end-4 [.toast:has([data-description])_&]:row-start-2 [.toast:has([data-description])_&]:!ml-0 [.toast:has([data-description])_&]:!mr-0 [.toast:has([data-description])_&]:justify-self-end [.toast:has([data-description])_&]:self-end [.toast:has([data-description]):has([data-cancel])_&]:col-start-4 [.toast:has([data-description]):has([data-cancel])_&]:col-end-5',
          cancelButton:
            '!-my-1 !h-7 !rounded-md [background:transparent!important] [border:1px_solid_hsl(var(--border))!important] [color:hsl(var(--foreground))!important] hover:[background:hsl(var(--accent))!important] hover:[color:hsl(var(--accent-foreground))!important] [.toast:has([data-description])_&]:!my-0 [.toast:has([data-description])_&]:col-start-3 [.toast:has([data-description])_&]:col-end-4 [.toast:has([data-description])_&]:row-start-2 [.toast:has([data-description])_&]:!ml-0 [.toast:has([data-description])_&]:!mr-0 [.toast:has([data-description])_&]:justify-self-end [.toast:has([data-description])_&]:self-end',
          icon: 'size-5 items-center justify-center !ml-0 [&_svg]:!ml-0 [&_svg]:!mr-0 mr-0 [.toast:has([data-description])_&]:col-start-1 [.toast:has([data-description])_&]:row-start-1',
          closeButton:
            'static order-last ml-1 h-5 w-5 shrink-0 self-center border-none !bg-transparent !text-muted-foreground hover:!text-foreground [transform:none] [&_svg]:size-4 [.toast:has([data-description])_&]:col-start-3 [.toast:has([data-description])_&]:row-start-1 [.toast:has([data-description])_&]:ml-0 [.toast:has([data-description])_&]:justify-self-end [.toast:has([data-description])_&]:self-start [.toast:has([data-description]):has([data-action]):has([data-cancel])_&]:col-start-4',
          content:
            'min-w-0 max-w-full flex-1 overflow-x-hidden max-h-[120px] overflow-y-auto whitespace-normal break-words [overflow-wrap:anywhere] scrollbar scrollbar-thumb-foreground/40 scrollbar-thumb-rounded-md scrollbar-w-[4px] will-change-transform [.toast:has([data-description])_&]:col-start-1 [.toast:has([data-description])_&]:col-end-4 [.toast:has([data-description])_&]:row-start-1 [.toast:has([data-description])_&]:grid [.toast:has([data-description])_&]:!max-h-none [.toast:has([data-description])_&]:grid-cols-[minmax(0,1fr)_1.25rem] [.toast:has([data-description])_&]:gap-x-2 [.toast:has([data-description])_&]:gap-y-1 [.toast:has([data-description])_&]:!overflow-visible [.toast:has([data-description])_&]:scrollbar-w-0 [.toast:has([data-description]):has([data-icon])_&]:grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] [.toast:has([data-description]):has([data-action]):has([data-cancel])_&]:col-end-5',
        },
        style: {
          background: 'hsl(var(--popover))',
          borderColor: 'hsl(var(--border-high))',
        },
      }}
      position={props.position ?? 'top-center'}
      {...props}
    />
  );
};

const DEFAULT_DURATION = 3 * 1000;
const toast: typeof sonnerToast = Object.assign(
  (message: ToastT['title'], data?: ExternalToast) =>
    sonnerToast(message, {
      duration: DEFAULT_DURATION,
      ...data,
    }),
  {
    ...sonnerToast,
    error: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.error(message, {
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    warning: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.warning(message, {
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    success: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.success(message, {
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    info: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.info(message, {
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    message: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.message(message, {
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
  }
);

export { Toaster, toast };
