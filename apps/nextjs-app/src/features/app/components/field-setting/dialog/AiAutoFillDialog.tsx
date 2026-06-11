import { AlertTriangle } from '@teable/icons';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
  Button,
  Label,
} from '@teable/ui-lib/shadcn';
import { RadioGroup, RadioGroupItem } from '@teable/ui-lib/shadcn/ui/radio-group';
import { Skeleton } from '@teable/ui-lib/shadcn/ui/skeleton';
import { useState, useEffect } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';

export type AiAutoFillMode = 'emptyOnly' | 'all' | 'saveOnly';

interface IAiAutoFillDialogProps {
  open: boolean;
  title?: string | React.ReactNode;
  rowCount: number;
  emptyCount?: number;
  filledCount?: number;
  isLoadingStats?: boolean;
  cancelText: string;
  /** Hide the "Save Only" option (useful for regenerate scenario where there's no config to save) */
  hideSaveOnly?: boolean;
  /** Hide the "Empty Only" option (useful for new fields where all cells are empty) */
  hideEmptyOnly?: boolean;
  labels: {
    /** Dynamic description with {{count}} placeholder */
    description: string;
    emptyOnly: string;
    emptyOnlyDesc: string;
    all: string;
    allDesc: string;
    saveOnly: string;
    saveOnlyDesc: string;
    recommended: string;
    limitWarning: string;
  };
  confirmLabels: {
    emptyOnly: string;
    all: string;
    saveOnly: string;
  };
  onClose: () => void;
  onConfirm: (mode: AiAutoFillMode) => void | Promise<void>;
}

export const AiAutoFillDialog = (props: IAiAutoFillDialogProps) => {
  const {
    open,
    title,
    rowCount,
    emptyCount,
    filledCount,
    isLoadingStats,
    cancelText,
    hideSaveOnly = false,
    hideEmptyOnly = false,
    labels,
    confirmLabels,
    onClose,
    onConfirm,
  } = props;
  const { task } = useEnv();
  const { maxTaskRows = 0 } = task ?? {};
  const [selectedMode, setSelectedMode] = useState<AiAutoFillMode>('emptyOnly');
  const [isLoading, setIsLoading] = useState(false);

  // Reset and auto-select appropriate mode when dialog opens or options change
  useEffect(() => {
    if (open) {
      // Auto-select 'all' mode when emptyOnly option is hidden or when there are no empty cells
      if (hideEmptyOnly || emptyCount === 0) {
        setSelectedMode('all');
      } else {
        setSelectedMode('emptyOnly');
      }
    }
  }, [open, emptyCount, hideEmptyOnly]);

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await onConfirm(selectedMode);
    } finally {
      setIsLoading(false);
    }
  };

  const getConfirmButtonText = () => {
    switch (selectedMode) {
      case 'emptyOnly':
        return confirmLabels.emptyOnly;
      case 'all':
        return confirmLabels.all;
      case 'saveOnly':
        return confirmLabels.saveOnly;
    }
  };

  // Disable emptyOnly if no empty cells
  const hasEmptyCells = emptyCount == null || emptyCount > 0;

  // Format count display
  const formatCount = (count: number | undefined) => {
    if (count == null) return null;
    return count.toLocaleString();
  };

  // Helper to apply max limit (0 means no limit)
  const limitByMax = (count: number) => (maxTaskRows > 0 ? Math.min(count, maxTaskRows) : count);
  const exceedsLimit = (count: number) => maxTaskRows > 0 && count > maxTaskRows;

  // Calculate actual counts that will be processed (limited by maxTaskRows)
  const actualEmptyCount = emptyCount != null ? limitByMax(emptyCount) : undefined;
  const actualAllCount = limitByMax(rowCount);

  // Check if current selection exceeds the limit
  const showLimitWarning =
    (selectedMode === 'emptyOnly' && emptyCount != null && exceedsLimit(emptyCount)) ||
    (selectedMode === 'all' && exceedsLimit(rowCount));

  // Get the actual count based on selected mode
  const getDisplayCount = () => {
    if (selectedMode === 'saveOnly') return 0;
    if (selectedMode === 'emptyOnly') {
      return actualEmptyCount ?? 0;
    }
    return actualAllCount;
  };

  // Replace {{count}} or {{rowCount}} in description with actual count
  const dynamicDescription = labels.description
    .replace(/\{\{count\}\}/g, formatCount(getDisplayCount()) ?? '0')
    .replace(/\{\{rowCount\}\}/g, formatCount(getDisplayCount()) ?? '0');

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent
        closeable={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="sm:max-w-md"
      >
        <DialogHeader className="space-y-2">
          {title && <DialogTitle>{title}</DialogTitle>}
          <DialogDescription>{dynamicDescription}</DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selectedMode}
          onValueChange={(value) => setSelectedMode(value as AiAutoFillMode)}
          className="space-y-3"
        >
          {/* Empty Only Mode - Recommended (hidden for new fields) */}
          {!hideEmptyOnly && (
            <div className="flex items-start space-x-3">
              <RadioGroupItem
                value="emptyOnly"
                id="emptyOnly"
                className="mt-1"
                disabled={!hasEmptyCells}
              />
              <div className="flex flex-1 flex-col gap-0.5">
                <Label
                  htmlFor="emptyOnly"
                  className={`flex cursor-pointer items-center gap-2 ${!hasEmptyCells ? 'text-muted-foreground' : ''}`}
                >
                  {labels.emptyOnly}
                  {isLoadingStats ? (
                    <Skeleton className="h-5 w-12" />
                  ) : (
                    emptyCount != null && (
                      <span className="text-xs text-muted-foreground">
                        ({formatCount(actualEmptyCount)} / {formatCount(rowCount)})
                      </span>
                    )
                  )}
                  {hasEmptyCells && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                      {labels.recommended}
                    </span>
                  )}
                </Label>
                <span className="text-xs text-muted-foreground">{labels.emptyOnlyDesc}</span>
              </div>
            </div>
          )}

          {/* All Mode */}
          <div className="flex items-start space-x-3">
            <RadioGroupItem value="all" id="all" className="mt-1" />
            <div className="flex flex-1 flex-col gap-0.5">
              <Label htmlFor="all" className="flex cursor-pointer items-center gap-2">
                {labels.all}
                {isLoadingStats ? (
                  <Skeleton className="h-5 w-12" />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    ({formatCount(actualAllCount)})
                  </span>
                )}
              </Label>
              <span className="text-xs text-muted-foreground">
                {labels.allDesc}
                {!isLoadingStats && filledCount != null && filledCount > 0 && (
                  <span className="text-orange-500"> ({formatCount(filledCount)})</span>
                )}
              </span>
            </div>
          </div>

          {/* Save Only Mode - hidden when hideSaveOnly is true */}
          {!hideSaveOnly && (
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="saveOnly" id="saveOnly" className="mt-1" />
              <div className="flex flex-1 flex-col gap-0.5">
                <Label htmlFor="saveOnly" className="cursor-pointer">
                  {labels.saveOnly}
                </Label>
                <span className="text-xs text-muted-foreground">{labels.saveOnlyDesc}</span>
              </div>
            </div>
          )}
        </RadioGroup>

        {/* Limit Warning */}
        {showLimitWarning && (
          <div className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{labels.limitWarning}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={isLoading}>
            {getConfirmButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
