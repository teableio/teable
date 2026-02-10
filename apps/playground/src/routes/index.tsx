import { Link, createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useLocalStorage } from 'usehooks-ts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
  PLAYGROUND_DB_URL_STORAGE_KEY,
  findPlaygroundDbConnectionByUrl,
  resolvePlaygroundDbUrl,
  resolvePlaygroundDbStorageKey,
  type PlaygroundDbConnection,
} from '@/lib/playground/databaseUrl';
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
  const [dbUrl] = useLocalStorage<string | null>(PLAYGROUND_DB_URL_STORAGE_KEY, null, {
    initializeWithValue: false,
  });
  const [dbConnections] = useLocalStorage<PlaygroundDbConnection[]>(
    PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
    [],
    { initializeWithValue: false }
  );
  const activeDbUrl = resolvePlaygroundDbUrl(dbUrl);
  const activeConnection = findPlaygroundDbConnectionByUrl(dbConnections, activeDbUrl);
  const baseStorageKey =
    env.kind === 'sandbox'
      ? env.storageKeys.baseId
      : resolvePlaygroundDbStorageKey(env.storageKeys.baseId, {
          connectionId: activeConnection?.id ?? null,
          dbUrl: activeDbUrl,
        });
  const tableStorageKey =
    env.kind === 'sandbox'
      ? env.storageKeys.tableId
      : resolvePlaygroundDbStorageKey(env.storageKeys.tableId, {
          connectionId: activeConnection?.id ?? null,
          dbUrl: activeDbUrl,
        });
  const [storedBaseId] = useLocalStorage<string | null>(baseStorageKey, null, {
    initializeWithValue: false,
  });
  const [storedTableId, , removeStoredTableId] = useLocalStorage<string | null>(
    tableStorageKey,
    null,
    { initializeWithValue: false }
  );

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const baseId = storedBaseId && storedBaseId.trim() ? storedBaseId : null;
    const tableId = storedTableId && storedTableId.trim() ? storedTableId : null;

    if (!baseId) {
      if (tableId) {
        removeStoredTableId();
      }
      setTarget(null);
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

  if (!hasHydrated) {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Welcome to the playground</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>No recent base found for this connection.</p>
          <Button asChild className="w-full">
            <Link to={env.routes.base} params={{ baseId: env.defaults.baseId }}>
              Open default base
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/computed-tasks">View Computed Tasks</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
