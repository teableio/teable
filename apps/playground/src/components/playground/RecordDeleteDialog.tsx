import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { IExplainResultDto } from '@teable/v2-contract-http';
import { useMutation } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ExplainResultPanel } from '@/components/playground/ExplainResultPanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';

type RecordDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: string;
  recordIds: string[];
  recordLabel?: string | null;
  isDeleting: boolean;
  onConfirm: () => void;
};

export function RecordDeleteDialog({
  open,
  onOpenChange,
  tableId,
  recordIds,
  recordLabel,
  isDeleting,
  onConfirm,
}: RecordDeleteDialogProps) {
  const [explainResult, setExplainResult] = useState<IExplainResultDto | null>(null);
  const [explainDialogOpen, setExplainDialogOpen] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState(true);
  const [explainTargetCount, setExplainTargetCount] = useState(0);
  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const normalizedLabel = recordLabel?.trim() ?? '';
  const analyzeId = useMemo(() => `record-delete-analyze-${tableId}`, [tableId]);

  const explainMutation = useMutation(
    orpc.tables.explainDeleteRecords.mutationOptions({
      onSuccess: (response) => {
        setExplainResult(response.data);
        setExplainDialogOpen(true);
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to explain command');
      },
    })
  );

  const handleExplainDelete = useCallback(() => {
    if (!recordIds.length) {
      toast.info('No records to explain');
      return;
    }
    setExplainTargetCount(recordIds.length);
    explainMutation.mutate({
      tableId,
      recordIds,
      analyze: analyzeMode,
      includeSql: true,
      includeGraph: false,
    });
  }, [analyzeMode, explainMutation, recordIds, tableId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (!nextOpen) {
        setExplainResult(null);
        setExplainDialogOpen(false);
        setExplainTargetCount(0);
        explainMutation.reset();
      }
    },
    [explainMutation, onOpenChange]
  );

  const explainDialogLabel = recordIds.length > 1 ? 'Delete Records' : 'Delete Record';
  const canDelete = recordIds.length > 0 && !isDeleting;
  const canExplain = recordIds.length > 0 && !explainMutation.isPending;

  return (
    <>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete record</AlertDialogTitle>
            <AlertDialogDescription>
              {recordIds.length > 1
                ? `Delete ${recordIds.length} records?`
                : normalizedLabel
                  ? `Delete "${normalizedLabel}"?`
                  : 'Delete this record?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between sm:items-center flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleExplainDelete}
                disabled={!canExplain}
                className="text-muted-foreground"
              >
                <Search className="mr-1.5 h-3.5 w-3.5" />
                {explainMutation.isPending ? 'Analyzing...' : 'Explain'}
              </Button>
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id={analyzeId}
                  checked={analyzeMode}
                  onCheckedChange={(checked) => setAnalyzeMode(!!checked)}
                />
                <Label htmlFor={analyzeId} className="text-xs text-muted-foreground cursor-pointer">
                  ANALYZE
                </Label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"
                onClick={onConfirm}
                disabled={!canDelete}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={explainDialogOpen} onOpenChange={setExplainDialogOpen}>
        <DialogContent className="sm:max-w-[90vw] w-[90vw] max-h-[85vh] overflow-visible flex flex-col">
          <DialogHeader>
            <DialogTitle>Explain: {explainDialogLabel}</DialogTitle>
            <DialogDescription>
              {explainTargetCount > 1
                ? `Analysis of deleting ${explainTargetCount} records`
                : 'Analysis of the delete record operation'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {explainResult && <ExplainResultPanel result={explainResult} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
