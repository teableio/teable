import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePlaygroundEnvironment } from '@/lib/playground/environment';

export const Route = createFileRoute('/')({ component: PlaygroundIndex });

type RedirectTarget =
  | { to: '/$baseId'; params: { baseId: string } }
  | { to: '/$baseId/$tableId'; params: { baseId: string; tableId: string } }
  | { to: '/sandbox/$baseId'; params: { baseId: string } }
  | { to: '/sandbox/$baseId/$tableId'; params: { baseId: string; tableId: string } }
  | null;

export function PlaygroundIndex() {
  const env = usePlaygroundEnvironment();
  const [target, setTarget] = useState<RedirectTarget>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [storedBaseId] = useLocalStorage<string | null>(env.storageKeys.baseId, null, {
    initializeWithValue: false,
  });
  const [storedTableId, , removeStoredTableId] = useLocalStorage<string | null>(
    env.storageKeys.tableId,
    null,
    { initializeWithValue: false }
  );

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const baseId = storedBaseId && storedBaseId.trim() ? storedBaseId : env.defaults.baseId;
    const tableId = storedTableId && storedTableId.trim() ? storedTableId : null;

    if (!storedBaseId || !storedBaseId.trim()) {
      if (tableId) {
        removeStoredTableId();
      }
      setTarget({ to: env.routes.base, params: { baseId } });
      return;
    }

    if (tableId) {
      setTarget({
        to: env.routes.table,
        params: { baseId, tableId },
      });
      return;
    }

    setTarget({ to: env.routes.base, params: { baseId } });
  }, [
    env.defaults.baseId,
    env.routes.base,
    env.routes.table,
    hasHydrated,
    removeStoredTableId,
    storedBaseId,
    storedTableId,
  ]);

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
