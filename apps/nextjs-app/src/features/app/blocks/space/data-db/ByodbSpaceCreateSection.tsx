import type { IDataDbPreflightVo } from '@teable/openapi';
import { Button, Input, Switch, cn } from '@teable/ui-lib/shadcn';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'next-i18next';

type DataDbMode = 'default' | 'byodb';

interface IByodbSpaceCreateSectionProps {
  mode: DataDbMode;
  url: string;
  preflightResult?: IDataDbPreflightVo;
  preflightError?: string;
  testedUrl?: string;
  isTesting?: boolean;
  onModeChange: (mode: DataDbMode) => void;
  onUrlChange: (url: string) => void;
  onTestConnection: () => void;
}

const requiredCapabilityKeys: Array<keyof IDataDbPreflightVo['capabilities']> = [
  'createSchema',
  'createTable',
  'createFunction',
  'createTrigger',
  'createRole',
  'grantPrivileges',
];

export const getDatabaseNameFromUrl = (url: string) => {
  try {
    return decodeURIComponent(new URL(url.trim()).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
};

export const setDatabaseNameInUrl = (url: string, database: string) => {
  try {
    const parsed = new URL(url.trim());
    parsed.pathname = `/${encodeURIComponent(database)}`;
    return parsed.toString();
  } catch {
    return url;
  }
};

export const ByodbSpaceCreateSection = (props: IByodbSpaceCreateSectionProps) => {
  const {
    mode,
    url,
    preflightResult,
    preflightError,
    testedUrl,
    isTesting,
    onModeChange,
    onUrlChange,
    onTestConnection,
  } = props;
  const { t } = useTranslation('space');
  const useByodb = mode === 'byodb';
  const trimmedUrl = url.trim();
  const hasStaleResult = Boolean(preflightResult && testedUrl !== trimmedUrl);
  const requiresDatabaseSelection = Boolean(
    preflightResult?.requiresDatabaseSelection && !hasStaleResult
  );
  const hasCapabilityResult = !preflightResult?.errors.some((error) =>
    ['CONNECTION_FAILED', 'IPV6_NETWORK_UNREACHABLE'].includes(error.code)
  );
  const missingCapabilities = preflightResult
    ? requiredCapabilityKeys.filter(
        (key) => hasCapabilityResult && !preflightResult.capabilities[key]
      )
    : [];
  const availableDatabases =
    preflightResult && !hasStaleResult ? preflightResult.availableDatabases ?? [] : [];
  const selectedDatabase = getDatabaseNameFromUrl(url);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('dataDb.create.title')}</p>
        <p className="text-xs text-muted-foreground">{t('dataDb.create.description')}</p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div className="space-y-1">
          <label htmlFor="byodb-space-create-switch" className="text-sm font-medium">
            {t('dataDb.create.byodbOption')}
          </label>
          <p className="text-xs text-muted-foreground">
            {useByodb ? t('dataDb.create.byodbHint') : t('dataDb.create.defaultHint')}
          </p>
        </div>
        <Switch
          id="byodb-space-create-switch"
          checked={useByodb}
          onCheckedChange={(checked) => onModeChange(checked ? 'byodb' : 'default')}
        />
      </div>

      {useByodb && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">{t('dataDb.create.urlLabel')}</label>
            <Input
              value={url}
              placeholder="postgresql://user:password@host:5432/database"
              onChange={(e) => onUrlChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('dataDb.create.sslHint')}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!trimmedUrl || isTesting}
              onClick={onTestConnection}
            >
              {isTesting ? t('dataDb.create.testing') : t('dataDb.create.testConnection')}
            </Button>
            {hasStaleResult && (
              <span className="text-xs text-muted-foreground">
                {t('dataDb.create.retestRequired')}
              </span>
            )}
          </div>

          {preflightError && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{preflightError}</span>
            </div>
          )}

          {availableDatabases.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('dataDb.create.databaseLabel')}</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={availableDatabases.includes(selectedDatabase) ? selectedDatabase : ''}
                onChange={(e) => onUrlChange(setDatabaseNameInUrl(url, e.target.value))}
              >
                <option value="" disabled>
                  {t('dataDb.create.databasePlaceholder')}
                </option>
                {availableDatabases.map((database) => (
                  <option key={database} value={database}>
                    {database}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t('dataDb.create.databaseHint')}</p>
            </div>
          )}

          {preflightResult && !hasStaleResult && !requiresDatabaseSelection && (
            <div
              className={cn('space-y-2 rounded-md border p-2 text-xs', {
                'border-green-500/40 bg-green-500/5': preflightResult.ok,
                'border-destructive/40 bg-destructive/5': !preflightResult.ok,
              })}
            >
              <div className="flex items-center gap-2 font-medium">
                {preflightResult.ok ? (
                  <CheckCircle2 className="size-4 text-green-600" />
                ) : (
                  <TriangleAlert className="size-4 text-destructive" />
                )}
                {preflightResult.ok
                  ? t('dataDb.create.preflightPassed')
                  : t('dataDb.create.preflightFailed')}
              </div>
              <div className="grid gap-1 text-muted-foreground sm:grid-cols-2">
                <span>
                  {t('dataDb.fields.host')}: {preflightResult.displayHost || '-'}
                </span>
                <span>
                  {t('dataDb.fields.database')}: {preflightResult.displayDatabase || '-'}
                </span>
                <span>
                  {t('dataDb.fields.internalSchema')}: {preflightResult.internalSchema || '-'}
                </span>
                <span>
                  {t('dataDb.fields.version')}: {preflightResult.serverVersion || '-'}
                </span>
                <span>
                  {t('dataDb.fields.classification')}: {preflightResult.classification}
                </span>
              </div>
              {missingCapabilities.length > 0 && (
                <div className="text-destructive">
                  {t('dataDb.create.missingCapabilities')}: {missingCapabilities.join(', ')}
                </div>
              )}
              {preflightResult.errors.map((error) => (
                <div key={`${error.code}-${error.message}`} className="text-destructive">
                  {t(`dataDb.create.errors.${error.code}.message`, {
                    defaultValue: error.message,
                  })}
                  {error.remediation
                    ? ` ${t(`dataDb.create.errors.${error.code}.remediation`, {
                        defaultValue: error.remediation,
                      })}`
                    : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
