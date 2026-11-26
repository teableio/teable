import { useQuery } from '@tanstack/react-query';
import { getShareSearchAccelerationStatus } from '@teable/openapi';
import { useTable } from '@teable/sdk/hooks';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { Zap } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { type ReactNode, useState } from 'react';
import {
  TableSearchAccelerationDialog,
  useAccelerationPermissions,
  useAccelerationStatus,
} from '../../base/base-side-bar/TableSearchAccelerationDialog';

function AccelerationBadge({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation(['table']);
  const title = t('table:searchAcceleration.title');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="max-w-28 shrink-0 gap-1 px-1"
          aria-label={`${title}: ${label}`}
        >
          <Zap className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 text-sm">
        <p className="font-medium">{title}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function GridMemberSearchAccelerationEntry({
  baseId,
  spaceId,
}: {
  baseId: string;
  spaceId: string;
}) {
  const table = useTable();
  return table ? (
    <MemberSearchAccelerationEntry
      key={table.id}
      baseId={baseId}
      spaceId={spaceId}
      tableId={table.id}
      tableName={table.name}
    />
  ) : null;
}

export function MemberSearchAccelerationEntry(props: {
  baseId: string;
  tableId: string;
  spaceId: string;
  tableName: string;
}) {
  const { baseId, tableId, spaceId } = props;
  const { t } = useTranslation(['table', 'common']);
  const [open, setOpen] = useState(false);
  const status = useAccelerationStatus(baseId, tableId);
  const access = useAccelerationPermissions(baseId, tableId, spaceId);
  const data = status.isSuccess ? status.data : undefined;
  const label = data
    ? t(`table:searchAcceleration.state.${data.intentState}`)
    : t(status.isError ? 'table:searchAcceleration.stateUnknown' : 'common:actions.loading');
  return (
    <>
      <AccelerationBadge label={label}>
        {data && (
          <p>
            {t(
              data.serving
                ? 'table:searchAcceleration.serving'
                : 'table:searchAcceleration.notServing'
            )}
          </p>
        )}
        {status.isError && <p>{t('table:searchAcceleration.statusError')}</p>}
        {access.accessError && <p>{t('table:searchAcceleration.permissionError')}</p>}
        {access.readOnly && <p>{t('table:searchAcceleration.contactAdmin')}</p>}
        {access.canManage && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t('table:searchAcceleration.configure')}
          </Button>
        )}
      </AccelerationBadge>
      {open && <TableSearchAccelerationDialog {...props} onOpenChange={setOpen} />}
    </>
  );
}

export function ShareSearchAccelerationEntry({ shareId }: { shareId: string }) {
  const { t } = useTranslation(['table', 'common']);
  const status = useQuery({
    queryKey: ['share-search-acceleration', shareId],
    queryFn: () => getShareSearchAccelerationStatus(shareId).then((res) => res.data),
    retry: false,
    staleTime: 10_000,
    gcTime: 10_000,
    meta: { preventGlobalError: true },
  });
  const label = status.isSuccess
    ? t(
        status.data.accelerationServing
          ? 'table:searchAcceleration.state.enabled'
          : 'table:searchAcceleration.state.disabled'
      )
    : t(status.isError ? 'table:searchAcceleration.stateUnknown' : 'common:actions.loading');
  return (
    <AccelerationBadge label={label}>
      {status.isError && <p>{t('table:searchAcceleration.statusError')}</p>}
      {status.isSuccess && (
        <p>
          {t(
            status.data.accelerationServing
              ? 'table:searchAcceleration.shareServing'
              : 'table:searchAcceleration.notServing'
          )}
        </p>
      )}
    </AccelerationBadge>
  );
}
