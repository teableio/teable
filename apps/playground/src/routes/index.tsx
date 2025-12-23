import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PLAYGROUND_BASE_ID,
  PLAYGROUND_BASE_ID_STORAGE_KEY,
  PLAYGROUND_TABLE_ID_STORAGE_KEY,
} from '@/lib/playground/constants';

export const Route = createFileRoute('/')({ component: PlaygroundIndex });

type RedirectTarget =
  | { to: '/$baseId'; params: { baseId: string } }
  | { to: '/$baseId/$tableId'; params: { baseId: string; tableId: string } }
  | null;

function PlaygroundIndex() {
  const [target, setTarget] = useState<RedirectTarget>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [storedBaseId] = useLocalStorage<string | null>(PLAYGROUND_BASE_ID_STORAGE_KEY, null, {
    initializeWithValue: false,
  });
  const [storedTableId, , removeStoredTableId] = useLocalStorage<string | null>(
    PLAYGROUND_TABLE_ID_STORAGE_KEY,
    null,
    { initializeWithValue: false }
  );

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const baseId = storedBaseId && storedBaseId.trim() ? storedBaseId : PLAYGROUND_BASE_ID;
    const tableId = storedTableId && storedTableId.trim() ? storedTableId : null;

    if (!storedBaseId || !storedBaseId.trim()) {
      if (tableId) {
        removeStoredTableId();
      }
      setTarget({ to: '/$baseId', params: { baseId } });
      return;
    }

    if (tableId) {
      setTarget({
        to: '/$baseId/$tableId',
        params: { baseId, tableId },
      });
      return;
    }

    setTarget({ to: '/$baseId', params: { baseId } });
  }, [hasHydrated, removeStoredTableId, storedBaseId, storedTableId]);

  if (target) {
    return <Navigate to={target.to} params={target.params} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Loading playground...</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Preparing your workspace.
        </CardContent>
      </Card>
    </div>
  );
}
