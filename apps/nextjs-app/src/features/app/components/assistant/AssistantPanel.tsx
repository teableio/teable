import { ActionSendEmail, ChatApp, MagicAi } from '@teable/icons';
import { TableContext } from '@teable/sdk/context';
import { useBaseId, useTableId } from '@teable/sdk/hooks';
import type { Table } from '@teable/sdk/model';
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@teable/ui-lib/shadcn';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';

interface IToolActivity {
  name: string;
  status: 'start' | 'ok' | 'error';
}

interface IChatEntry {
  role: 'user' | 'assistant';
  content: string;
  tools?: IToolActivity[];
  failed?: boolean;
}

interface IAssistantPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Fork-only, intentionally English-only (no i18n keys yet).
const UI = {
  title: 'AI assistant',
  subtitle: 'Ask about this workspace or tell me what to change.',
  placeholder: 'Ask a question or describe a change…',
  empty: 'Try: “Summarise the records in this view” or “Add a task due Friday”.',
};

const applyEvent = (
  entry: IChatEntry,
  event: {
    type?: string;
    text?: string;
    name?: string;
    status?: IToolActivity['status'];
    message?: string;
  }
): IChatEntry => {
  switch (event.type) {
    case 'text':
      return { ...entry, content: entry.content + (event.text ?? '') };
    case 'tool': {
      if (!event.name || !event.status) {
        return entry;
      }
      const tools = [...(entry.tools ?? [])];
      if (event.status === 'start') {
        tools.push({ name: event.name, status: 'start' });
      } else {
        const index = tools.findIndex(
          (tool) => tool.name === event.name && tool.status === 'start'
        );
        if (index >= 0) {
          tools[index] = { name: event.name, status: event.status };
        } else {
          tools.push({ name: event.name, status: event.status });
        }
      }
      return { ...entry, tools };
    }
    case 'error':
      return { ...entry, content: entry.content || `⚠️ ${event.message ?? 'error'}`, failed: true };
    default:
      return entry;
  }
};

/** Splits a partial SSE buffer into complete JSON events and the remainder. */
const parseSseEvents = (buffer: string): { events: Record<string, unknown>[]; rest: string } => {
  const events: Record<string, unknown>[] = [];
  let rest = buffer;
  let separator = rest.indexOf('\n\n');

  while (separator >= 0) {
    const rawEvent = rest.slice(0, separator);
    rest = rest.slice(separator + 2);
    separator = rest.indexOf('\n\n');

    const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) {
      continue;
    }
    const payload = dataLine.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }
    try {
      events.push(JSON.parse(payload) as Record<string, unknown>);
    } catch {
      // Ignore non-JSON keep-alive frames.
    }
  }

  return { events, rest };
};

export const AssistantPanel: React.FC<IAssistantPanelProps> = ({ open, onOpenChange }) => {
  const baseId = useBaseId();
  const tableId = useTableId();
  // useTable() assumes a base layout, but this drawer is mounted in layouts
  // without a TableContext too (e.g. /space): read the context defensively.
  const tables = (useContext(TableContext) as { tables: Table[] } | null)?.tables;
  const table = tables?.find((item) => item.id === tableId);
  const [messages, setMessages] = useState<IChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const updateLastAssistant = useCallback((updater: (entry: IChatEntry) => IChatEntry) => {
    setMessages((previous) => {
      const next = [...previous];
      for (let index = next.length - 1; index >= 0; index--) {
        if (next[index].role === 'assistant') {
          next[index] = updater(next[index]);
          break;
        }
      }
      return next;
    });
  }, []);

  const sendMessage = useCallback(async () => {
    const content = input.trim();
    if (!content || streaming) {
      return;
    }

    const history: IChatEntry[] = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '', tools: [] }]);
    setInput('');
    setStreaming(true);

    try {
      const response = await fetch('/api/ssa/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content: text }) => ({ role, content: text })),
          context: { baseId, tableId, tableName: table?.name },
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        finished = done;
        if (!value) {
          continue;
        }
        buffer += decoder.decode(value, { stream: true });

        const { events, rest } = parseSseEvents(buffer);
        buffer = rest;
        for (const event of events) {
          updateLastAssistant((entry) => applyEvent(entry, event));
        }
      }
    } catch (error) {
      updateLastAssistant((entry) => ({
        ...entry,
        failed: true,
        content:
          entry.content ||
          `⚠️ ${error instanceof Error ? error.message : 'assistant request failed'}`,
      }));
    } finally {
      setStreaming(false);
      updateLastAssistant((entry) =>
        entry.content || entry.failed
          ? entry
          : { ...entry, failed: true, content: '⚠️ no response from the assistant' }
      );
    }
  }, [baseId, input, messages, streaming, table?.name, tableId, updateLastAssistant]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-screen flex-col p-0 sm:w-[440px] sm:max-w-[440px]"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ChatApp className="size-4 text-violet-500" />
            {UI.title}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">{UI.subtitle}</p>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
              <MagicAi className="size-5" />
              <p>{UI.empty}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-2">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex flex-col gap-1 ${
                    message.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : message.failed
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-muted'
                    }`}
                  >
                    {message.content || (streaming && !message.failed ? '…' : '')}
                  </div>
                  {message.tools?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {message.tools.map((tool, toolIndex) => (
                        <span
                          key={`${tool.name}-${toolIndex}`}
                          className={`rounded-full px-2 py-0.5 text-[11px] ${
                            tool.status === 'start'
                              ? 'bg-amber-100 text-amber-700'
                              : tool.status === 'ok'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {tool.status === 'start' ? '⏳' : tool.status === 'ok' ? '✓' : '✕'}{' '}
                          {tool.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-end gap-2 border-t p-3">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={UI.placeholder}
            rows={2}
            className="min-h-[40px] resize-none text-sm"
            disabled={streaming}
          />
          <Button
            size="icon"
            onClick={() => void sendMessage()}
            disabled={streaming || !input.trim()}
          >
            <ActionSendEmail className="size-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
