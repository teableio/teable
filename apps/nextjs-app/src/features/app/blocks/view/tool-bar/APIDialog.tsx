import { Code2 } from '@teable/icons';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
} from '@teable/ui-lib/shadcn';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import { useCallback, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

// Skeleton component for loading state
const APIDialogSkeleton = () => {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Tab skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Token section skeleton */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-12" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
      </div>

      {/* Content area skeleton */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <div className="flex-1 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="pt-4">
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="pt-4">
              <Skeleton className="h-16 w-full rounded-md" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

// Dynamically import the heavy content component
const APIDialogContent = dynamic(
  () => import('./APIDialogContent').then((mod) => mod.APIDialogContent),
  {
    loading: () => <APIDialogSkeleton />,
    ssr: false,
  }
);

interface APIDialogProps {
  open?: boolean;
  setOpen?: (open: boolean) => void;
  children: React.ReactNode;
}

export const APIDialog = ({ open, setOpen, children }: APIDialogProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isControlled) {
        setOpen?.(open);
      } else {
        setInternalOpen(open);
      }
    },
    [isControlled, setOpen]
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code2 className="size-5" />
            {t('table:toolbar.others.api.title')}
          </DialogTitle>
        </DialogHeader>

        {isOpen && <APIDialogContent onOpenChange={handleOpenChange} />}
      </DialogContent>
    </Dialog>
  );
};
