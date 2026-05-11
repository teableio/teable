import { AlertCircle, AppWindowMacIcon } from 'lucide-react';

export const LoginAppWarning = ({
  message,
  apps,
}: {
  message: string;
  apps: Array<{ id: string; name: string }>;
}) => {
  return (
    <div className="rounded-md border border-amber-200/70 bg-amber-50/80 px-3 py-2 text-[13px] text-amber-950 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div>
          <p>{message}</p>
          <ul className="mt-1 space-y-0.5 text-amber-900/90 dark:text-amber-300/90">
            {apps.map((app) => (
              <li key={app.id} className="flex items-center gap-1.5">
                <AppWindowMacIcon className="size-3.5 shrink-0" />
                {app.name || app.id}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
