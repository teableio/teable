import { AlertCircle, CheckCircle2 } from '@teable/icons';
import { Spin } from '@teable/ui-lib/index';
import { cn } from '@teable/ui-lib/shadcn';
import React from 'react';

export interface ILogEntry {
  message: string;
  type: 'info' | 'error' | 'done';
  timestamp: number;
}

interface IImportLogPanelProps {
  logs: ILogEntry[];
  isImporting: boolean;
}

export const ImportLogPanel = ({ logs, isImporting }: IImportLogPanelProps) => {
  const logEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden rounded-md border bg-background">
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-6">
        {logs.map((log, i) => (
          <div key={log.timestamp + i} className="flex items-start gap-2">
            {log.type === 'error' ? (
              <AlertCircle className="mt-1 size-3.5 shrink-0 text-destructive" />
            ) : log.type === 'done' ? (
              <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-green-500" />
            ) : i === logs.length - 1 && isImporting ? (
              <Spin className="mt-1 size-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span
              className={cn('break-all', {
                'text-destructive': log.type === 'error',
                'text-green-500': log.type === 'done',
                'text-foreground': log.type === 'info' && i === logs.length - 1,
                'text-muted-foreground': log.type === 'info' && i !== logs.length - 1,
              })}
            >
              {log.message}
            </span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};
