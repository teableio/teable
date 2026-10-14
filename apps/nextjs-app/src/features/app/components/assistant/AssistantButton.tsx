import { ChatApp } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import React, { useEffect, useState } from 'react';
import { AssistantPanel } from './AssistantPanel';

/**
 * SSA fork: assistant entry point. Renders only when the deployment has the
 * companion service configured (checked through the same-origin proxy).
 */
export const AssistantButton: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ssa/assistant/config')
      .then((response) => response.json())
      .then((payload: { enabled?: boolean }) => {
        if (!cancelled) {
          setEnabled(Boolean(payload?.enabled));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnabled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        title="AI assistant"
        onClick={() => setOpen(true)}
      >
        <ChatApp className="size-4" />
      </Button>
      <AssistantPanel open={open} onOpenChange={setOpen} />
    </>
  );
};
