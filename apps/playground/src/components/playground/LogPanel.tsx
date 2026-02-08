import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  ChevronDown,
  ChevronUp,
  Circle,
  Info,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Search,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { parseAsBoolean, useQueryState } from 'nuqs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useLogStream, type LogEntry, type LogLevel } from '@/hooks/useLogStream';

type LogLevelConfig = {
  icon: typeof Info;
  className: string;
  badgeClassName: string;
  label: string;
};

const LOG_LEVEL_CONFIG: Record<LogLevel, LogLevelConfig> = {
  debug: {
    icon: Bug,
    className: 'text-slate-500',
    badgeClassName: 'bg-slate-500/10 text-slate-600 border-slate-500/30',
    label: 'DEBUG',
  },
  info: {
    icon: Info,
    className: 'text-blue-500',
    badgeClassName: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    label: 'INFO',
  },
  warn: {
    icon: AlertTriangle,
    className: 'text-amber-500',
    badgeClassName: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    label: 'WARN',
  },
  error: {
    icon: AlertCircle,
    className: 'text-red-500',
    badgeClassName: 'bg-red-500/10 text-red-600 border-red-500/30',
    label: 'ERROR',
  },
};

const ALL_LEVELS: ReadonlyArray<LogLevel> = ['debug', 'info', 'warn', 'error'];

type PanelSize = 'normal' | 'large';

const PANEL_SIZE_CONFIG: Record<PanelSize, { width: string; height: string }> = {
  normal: { width: 'w-[600px]', height: 'h-[320px]' },
  large: { width: 'w-[900px]', height: 'h-[500px]' },
};

const LOG_PANEL_SIZE_KEY = 'teable-log-panel-size';

const readStoredSize = (): PanelSize => {
  if (typeof window === 'undefined') return 'normal';
  const stored = localStorage.getItem(LOG_PANEL_SIZE_KEY);
  if (stored === 'large' || stored === 'normal') return stored;
  return 'normal';
};

const storeSize = (size: PanelSize): void => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOG_PANEL_SIZE_KEY, size);
};

type LogPanelProps = {
  className?: string;
  defaultLevels?: ReadonlyArray<LogLevel>;
};

export function LogPanel({
  className,
  defaultLevels = ['debug', 'info', 'warn', 'error'],
}: LogPanelProps) {
  // Use URL query param for expanded state
  const [expanded, setExpanded] = useQueryState('logs', parseAsBoolean.withDefault(false));

  // Use localStorage for panel size
  const [panelSize, setPanelSize] = useState<PanelSize>(() => readStoredSize());
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set(defaultLevels));
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sizeConfig = PANEL_SIZE_CONFIG[panelSize];
  const isLarge = panelSize === 'large';

  const toggleSize = useCallback(() => {
    setPanelSize((prev) => {
      const next = prev === 'normal' ? 'large' : 'normal';
      storeSize(next);
      return next;
    });
  }, []);

  const { logs, status, paused, pause, resume, clear } = useLogStream({
    enabled: expanded,
  });

  // Filter logs by level and search query
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (!enabledLevels.has(log.level)) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesMessage = log.message.toLowerCase().includes(query);
        const matchesContext = log.context
          ? JSON.stringify(log.context).toLowerCase().includes(query)
          : false;
        if (!matchesMessage && !matchesContext) return false;
      }
      return true;
    });
  }, [logs, enabledLevels, searchQuery]);

  // Count logs by level
  const levelCounts = useMemo(() => {
    const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const log of logs) {
      counts[log.level]++;
    }
    return counts;
  }, [logs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-slot="scroll-area-viewport"]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [filteredLogs, autoScroll]);

  const toggleLevel = useCallback((level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const isConnected = status === 'connected';

  if (!expanded) {
    return (
      <div className={cn('fixed bottom-4 right-4 z-50', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="relative h-10 w-10 rounded-full bg-background/95 backdrop-blur shadow-lg hover:shadow-xl transition-shadow"
              onClick={() => void setExpanded(true)}
            >
              <Terminal className="h-5 w-5" />
              {levelCounts.error > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {levelCounts.error > 99 ? '99+' : levelCounts.error}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Open log panel</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col rounded-xl border bg-background/95 backdrop-blur shadow-2xl transition-all duration-200',
        sizeConfig.width,
        isLarge && 'max-h-[calc(100vh-2rem)]',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Logs</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {filteredLogs.length}
          </Badge>
        </div>

        <div className="flex-1" />

        {/* Connection Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs',
                isConnected ? 'text-emerald-600' : 'text-muted-foreground'
              )}
            >
              {isConnected ? (
                <>
                  <Wifi className="h-3.5 w-3.5" />
                  <Circle className="h-1.5 w-1.5 fill-current animate-pulse" />
                </>
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {isConnected ? 'Connected to log stream' : `Status: ${status}`}
          </TooltipContent>
        </Tooltip>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={paused ? resume : pause}>
                {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{paused ? 'Resume' : 'Pause'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={clear}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear logs</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setAutoScroll(!autoScroll)}
                className={autoScroll ? 'text-primary' : ''}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={toggleSize}>
                {isLarge ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isLarge ? 'Shrink panel' : 'Expand panel'}</TooltipContent>
          </Tooltip>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void setExpanded(null)}
            className="ml-1"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>

        {/* Level Filters */}
        <div className="flex items-center gap-1">
          {ALL_LEVELS.map((level) => {
            const config = LOG_LEVEL_CONFIG[level];
            const Icon = config.icon;
            const isActive = enabledLevels.has(level);
            const count = levelCounts[level];

            return (
              <Tooltip key={level}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleLevel(level)}
                    className={cn(
                      'h-7 gap-1 px-2 text-xs',
                      isActive ? config.className : 'text-muted-foreground opacity-50'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{count}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isActive ? `Hide ${level}` : `Show ${level}`}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Log List */}
      <ScrollArea className={cn('transition-all duration-200', sizeConfig.height)} ref={scrollRef}>
        <div className="p-2 space-y-0.5">
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Terminal className="h-8 w-8 mb-2 opacity-40" />
              <span className="text-sm">No logs to display</span>
              {!isConnected && <span className="text-xs mt-1">Waiting for connection...</span>}
            </div>
          ) : (
            filteredLogs.map((log) => <LogRow key={log.id} log={log} />)
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      {paused && (
        <div className="flex items-center justify-center border-t px-3 py-1.5 text-xs text-muted-foreground bg-amber-500/5">
          <Pause className="h-3 w-3 mr-1.5" />
          Log reception paused
        </div>
      )}
    </div>
  );
}

type LogRowProps = {
  log: LogEntry;
};

function LogRow({ log }: LogRowProps) {
  const [expanded, setExpanded] = useState(false);
  const config = LOG_LEVEL_CONFIG[log.level];
  const Icon = config.icon;
  const hasContext = log.context && Object.keys(log.context).length > 0;

  const timestamp = useMemo(() => {
    const date = new Date(log.timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  }, [log.timestamp]);

  return (
    <div
      className={cn(
        'group rounded-md px-2 py-1 text-xs font-mono transition-colors hover:bg-muted/50',
        log.level === 'error' && 'bg-red-500/5 hover:bg-red-500/10',
        log.level === 'warn' && 'bg-amber-500/5 hover:bg-amber-500/10'
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', config.className)} />
        <span className="text-muted-foreground shrink-0 select-none">{timestamp}</span>
        <Badge
          variant="outline"
          className={cn('px-1 py-0 text-[9px] shrink-0', config.badgeClassName)}
        >
          {config.label}
        </Badge>
        <span className="flex-1 break-all">{log.message}</span>
        {hasContext && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        )}
      </div>
      {expanded && hasContext && (
        <div className="mt-1.5 ml-6 rounded bg-muted/50 p-2 text-[10px] overflow-x-auto">
          <pre className="text-muted-foreground whitespace-pre-wrap">
            {JSON.stringify(log.context, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
