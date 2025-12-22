import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PLAYGROUND_BASE_ID, PLAYGROUND_TABLE_ID_STORAGE_KEY } from '@/lib/playground/constants';

export const Route = createFileRoute('/')({ component: PlaygroundIndex });

type RedirectTarget = { baseId: string; tableId: string } | null;

function PlaygroundIndex() {
  const [target, setTarget] = useState<RedirectTarget>(null);

  useEffect(() => {
    const storedTableId = localStorage.getItem(PLAYGROUND_TABLE_ID_STORAGE_KEY);
    setTarget({
      baseId: PLAYGROUND_BASE_ID,
      tableId: storedTableId ?? 'new',
    });
  }, []);

  if (target) {
    return <Navigate to="/$baseId/$tableId" params={target} replace />;
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
