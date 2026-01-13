import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type OutboxTask = {
  id: string;
  baseId: string;
  seedTableId: string;
  status: string;
  changeType: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  planHash: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  seedCount: number;
};

type DeadLetter = {
  id: string;
  baseId: string;
  seedTableId: string;
  status: string;
  changeType: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  planHash: string;
  runId: string;
  failedAt: string;
  createdAt: string;
  traceData: unknown | null;
  seedCount: number;
};

type TraceStep = {
  stepIndex: number;
  level: number;
  tableId: string;
  fieldId: string;
  sql?: string;
  paramCount?: number;
  dirtyRecordCount?: number;
  durationMs?: number;
  error?: string;
};

type TraceData = {
  requestId?: string;
  taskId?: string;
  steps?: TraceStep[];
  attempts?: number;
  totalDurationMs?: number;
  finalError?: string;
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString();
};

const StatusBadge = ({ status }: { status: string }) => {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="default" className="gap-1 bg-blue-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Processing
        </Badge>
      );
    case 'completed':
      return (
        <Badge variant="default" className="gap-1 bg-green-500">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export function ComputedTasksPanel() {
  const queryClient = useQueryClient();
  const [selectedDeadLetter, setSelectedDeadLetter] = useState<DeadLetter | null>(null);

  const outboxQuery = useQuery({
    queryKey: ['computed-tasks', 'outbox'],
    queryFn: async () => {
      const response = await fetch('/api/computed-tasks/outbox');
      if (!response.ok) {
        throw new Error('Failed to fetch outbox tasks');
      }
      return response.json() as Promise<{ items: OutboxTask[]; total: number }>;
    },
    refetchInterval: 5000,
  });

  const deadLettersQuery = useQuery({
    queryKey: ['computed-tasks', 'dead-letters'],
    queryFn: async () => {
      const response = await fetch('/api/computed-tasks/dead-letters');
      if (!response.ok) {
        throw new Error('Failed to fetch dead letters');
      }
      return response.json() as Promise<{ items: DeadLetter[]; total: number }>;
    },
    refetchInterval: 10000,
  });

  const retryMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/computed-tasks/${taskId}/retry-now`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to retry task');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Task queued for immediate retry');
      void queryClient.invalidateQueries({ queryKey: ['computed-tasks'] });
    },
    onError: (error) => {
      toast.error(`Failed to retry: ${error.message}`);
    },
  });

  const replayMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/computed-tasks/dead-letters/${taskId}/replay`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to replay dead letter');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Dead letter replayed successfully');
      void queryClient.invalidateQueries({ queryKey: ['computed-tasks'] });
    },
    onError: (error) => {
      toast.error(`Failed to replay: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/computed-tasks/dead-letters/${taskId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete dead letter');
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success('Dead letter deleted');
      void queryClient.invalidateQueries({ queryKey: ['computed-tasks'] });
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['computed-tasks'] });
  };

  const outboxTasks = outboxQuery.data?.items ?? [];
  const deadLetters = deadLettersQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Computed Update Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Monitor and manage computed field update tasks
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {outboxTasks.filter((t) => t.status === 'pending').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Processing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {outboxTasks.filter((t) => t.status === 'processing').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Dead Letters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{deadLetters.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="outbox">
        <TabsList>
          <TabsTrigger value="outbox">
            Outbox
            {outboxTasks.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {outboxTasks.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="dead-letters">
            Dead Letters
            {deadLetters.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {deadLetters.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outbox" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Outbox Tasks</CardTitle>
              <CardDescription>
                Tasks waiting to be processed or currently processing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {outboxQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : outboxTasks.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No pending tasks</div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run ID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Change Type</TableHead>
                        <TableHead>Seeds</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Next Run</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outboxTasks.map((task) => (
                        <TableRow key={task.id}>
                          <TableCell className="font-mono text-xs">{task.runId}</TableCell>
                          <TableCell>
                            <StatusBadge status={task.status} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{task.changeType}</Badge>
                          </TableCell>
                          <TableCell>{task.seedCount}</TableCell>
                          <TableCell>
                            {task.attempts}/{task.maxAttempts}
                          </TableCell>
                          <TableCell className="text-xs">{formatDate(task.nextRunAt)}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-destructive">
                            {task.lastError}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryMutation.mutate(task.id)}
                              disabled={retryMutation.isPending}
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dead-letters" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Dead Letters</CardTitle>
              <CardDescription>Failed tasks that exceeded maximum retry attempts</CardDescription>
            </CardHeader>
            <CardContent>
              {deadLettersQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : deadLetters.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No dead letters</div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run ID</TableHead>
                        <TableHead>Change Type</TableHead>
                        <TableHead>Seeds</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Failed At</TableHead>
                        <TableHead>Error</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deadLetters.map((dl) => (
                        <TableRow key={dl.id}>
                          <TableCell className="font-mono text-xs">{dl.runId}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{dl.changeType}</Badge>
                          </TableCell>
                          <TableCell>{dl.seedCount}</TableCell>
                          <TableCell>{dl.attempts}</TableCell>
                          <TableCell className="text-xs">{formatDate(dl.failedAt)}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-destructive">
                            {dl.lastError}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {dl.traceData && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedDeadLetter(dl)}
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => replayMutation.mutate(dl.id)}
                                disabled={replayMutation.isPending}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteMutation.mutate(dl.id)}
                                disabled={deleteMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedDeadLetter} onOpenChange={() => setSelectedDeadLetter(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Task Trace</DialogTitle>
            <DialogDescription>Run ID: {selectedDeadLetter?.runId}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1">
            <TraceView traceData={selectedDeadLetter?.traceData as TraceData | null} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TraceView({ traceData }: { traceData: TraceData | null }) {
  if (!traceData) {
    return <div className="text-muted-foreground">No trace data available</div>;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Request ID:</span>
          <span className="font-mono">{traceData.requestId ?? 'N/A'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Duration:</span>
          <span>{traceData.totalDurationMs ? `${traceData.totalDurationMs}ms` : 'N/A'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Attempts:</span>
          <span>{traceData.attempts ?? 'N/A'}</span>
        </div>
      </div>

      {traceData.finalError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">Final Error</p>
          <p className="mt-1 text-sm">{traceData.finalError}</p>
        </div>
      )}

      {traceData.steps && traceData.steps.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Execution Steps</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Table ID</TableHead>
                <TableHead>Field ID</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traceData.steps.map((step, index) => (
                <TableRow key={index}>
                  <TableCell>{step.stepIndex}</TableCell>
                  <TableCell>{step.level}</TableCell>
                  <TableCell className="font-mono text-xs">{step.tableId}</TableCell>
                  <TableCell className="font-mono text-xs">{step.fieldId}</TableCell>
                  <TableCell>{step.durationMs ? `${step.durationMs}ms` : '-'}</TableCell>
                  <TableCell>
                    {step.error ? (
                      <Badge variant="destructive">Error</Badge>
                    ) : (
                      <Badge variant="default" className="bg-green-500">
                        OK
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
