'use client';

import { useTheme } from '@teable/next-themes';
import type { ExternalToast } from 'sonner';
import { Toaster as Sonner, toast as sonnerToast } from 'sonner';
import { cn } from '../utils';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      richColors
      className={cn('toaster group')}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg items-start',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          icon: 'items-start',
          closeButton:
            'top-[16px] right-0 left-[unset] border-none !text-foreground !bg-transparent',
        },
        style: {
          background: 'hsl(var(--background))',
          borderColor: 'hsl(var(--border))',
        },
      }}
      position={props.position ?? 'top-center'}
      {...props}
    />
  );
};

const originalError = sonnerToast.error;

const toast: typeof sonnerToast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  {
    ...sonnerToast,
    error: (message: string | React.ReactNode, data?: ExternalToast) => {
      return originalError(message, {
        closeButton: true,
        className: 'pointer-events-auto',
        ...data,
      });
    },
  }
);

export { Toaster, toast };
