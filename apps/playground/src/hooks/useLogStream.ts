import { useCallback, useEffect, useRef, useState } from 'react';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export type LogStreamStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseLogStreamOptions {
  /**
   * Whether the stream should be enabled. Defaults to true.
   */
  enabled?: boolean;

  /**
   * Maximum number of log entries to keep in memory. Defaults to 1000.
   */
  maxEntries?: number;

  /**
   * Custom URL for the log stream endpoint. Defaults to '/api/logs/stream'.
   */
  url?: string;

  /**
   * Callback when a new log entry is received.
   */
  onEntry?: (entry: LogEntry) => void;
}

export interface UseLogStreamResult {
  /**
   * Array of log entries received from the stream.
   */
  logs: ReadonlyArray<LogEntry>;

  /**
   * Current connection status.
   */
  status: LogStreamStatus;

  /**
   * Error message if status is 'error'.
   */
  error: string | null;

  /**
   * Whether log reception is paused.
   */
  paused: boolean;

  /**
   * Pause receiving new logs (keeps connection open but stops updating state).
   */
  pause: () => void;

  /**
   * Resume receiving new logs.
   */
  resume: () => void;

  /**
   * Clear all stored log entries.
   */
  clear: () => void;

  /**
   * Manually reconnect to the stream.
   */
  reconnect: () => void;
}

const DEFAULT_URL = '/api/logs/stream';
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Hook to subscribe to the real-time log stream via SSE.
 *
 * @example
 * ```tsx
 * const { logs, status, pause, resume, clear } = useLogStream();
 *
 * return (
 *   <div>
 *     <span>Status: {status}</span>
 *     <button onClick={pause}>Pause</button>
 *     <button onClick={resume}>Resume</button>
 *     <button onClick={clear}>Clear</button>
 *     <ul>
 *       {logs.map(log => (
 *         <li key={log.id}>[{log.level}] {log.message}</li>
 *       ))}
 *     </ul>
 *   </div>
 * );
 * ```
 */
export const useLogStream = (options?: UseLogStreamOptions): UseLogStreamResult => {
  const {
    enabled = true,
    maxEntries = DEFAULT_MAX_ENTRIES,
    url = DEFAULT_URL,
    onEntry,
  } = options ?? {};

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<LogStreamStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(paused);
  const onEntryRef = useRef(onEntry);

  // Keep refs in sync
  pausedRef.current = paused;
  onEntryRef.current = onEntry;

  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  const pause = useCallback(() => {
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
  }, []);

  const [reconnectKey, setReconnectKey] = useState(0);

  const reconnect = useCallback(() => {
    setReconnectKey((k) => k + 1);
    setStatus('disconnected');
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return;
    }

    let isActive = true;
    setStatus('connecting');
    setError(null);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      if (!isActive) return;
      setStatus('connected');
      setError(null);
    };

    eventSource.onmessage = (event) => {
      if (!isActive) return;

      try {
        const entry = JSON.parse(event.data) as LogEntry;

        // Call the onEntry callback regardless of pause state
        onEntryRef.current?.(entry);

        // Only update state if not paused
        if (!pausedRef.current) {
          setLogs((prev) => {
            const next = [...prev, entry];
            // Trim to maxEntries
            if (next.length > maxEntries) {
              return next.slice(-maxEntries);
            }
            return next;
          });
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      if (!isActive) return;
      setStatus('error');
      setError('Connection lost. Attempting to reconnect...');
    };

    return () => {
      isActive = false;
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [enabled, url, maxEntries, reconnectKey]);

  return {
    logs,
    status,
    error,
    paused,
    pause,
    resume,
    clear,
    reconnect,
  };
};
