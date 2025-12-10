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
            'group toast group-[.toaster]:bg-popover group-[.toaster]:text-foreground group-[.toaster]:border-border-high group-[.toaster]:shadow-lg items-start',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground self-center',
          cancelButton: 'group-[.toast]:bg-transparent group-[.toast]:text-muted-foreground',
          icon: 'items-start',
          closeButton:
            'top-[12px] right-0 left-[unset] border-none !text-foreground !bg-transparent',
          content:
            'max-h-[120px] overflow-y-auto scrollbar scrollbar-thumb-foreground/40 scrollbar-thumb-rounded-md scrollbar-w-[4px] will-change-transform',
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

const DEFAULT_DURATION = 2 * 1000;
const toast: typeof sonnerToast = Object.assign(
  (message: ToastT['title'], data?: ExternalToast) =>
    sonnerToast(message, {
      closeButton: true,
      duration: DEFAULT_DURATION,
      ...data,
    }),
  {
    ...sonnerToast,
    error: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.error(message, {
        closeButton: true,
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    warning: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.warning(message, {
        closeButton: true,
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    success: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.success(message, {
        closeButton: true,
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    info: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.info(message, {
        closeButton: true,
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
    message: (message: ToastT['title'], data?: ExternalToast) => {
      return sonnerToast.message(message, {
        closeButton: true,
        duration: DEFAULT_DURATION,
        ...data,
      });
    },
  }
);

export { Toaster, toast };
