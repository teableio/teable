import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IAttachmentFieldOptions } from '@teable/core';
import type { IPublicFileStatusVo } from '@teable/openapi';
import {
  BillingProductLevel,
  getPublicFileStatus,
  PublicFileAvailability,
  retryPublicFiles,
  UsageFeatureLimit,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBase, useField, useTableId } from '@teable/sdk/hooks';
import { Button, Label, Switch } from '@teable/ui-lib/shadcn';
import ms from 'ms';
import { useTranslation } from 'next-i18next';
import type { ReactElement } from 'react';
import { UpgradeWrapper } from '@/features/app/components/billing/UpgradeWrapper';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { isPublicAttachmentField } from '@/features/app/hooks/usePublicFileEnabled';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { tableConfig } from '@/features/i18n/table.config';

/**
 * The settings poll the copy progress of a field saved public while they are open (no push):
 * often while files are being copied, now and then otherwise to catch new uploads. Whether it is
 * saved public comes with the loaded field, so a private one asks nothing.
 */
const COPYING_POLL_INTERVAL = ms('3s');
const IDLE_POLL_INTERVAL = ms('15s');

/** Failure reasons shown in the status line's tooltip. */
const FAILURE_REASONS_SHOWN = 5;

const PublicFileStatusLine = (props: {
  status: IPublicFileStatusVo;
  retrying: boolean;
  onRetry: () => void;
}) => {
  const { status, retrying, onRetry } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const reasons = status.failures
    .slice(0, FAILURE_REASONS_SHOWN)
    .map(({ name, error }) => `${name || '-'}: ${error}`)
    .join('\n');
  // Without the plan nothing new is copied, and the counts cannot tell those files from the
  // public ones, so only the reason shows.
  if (status.availability === PublicFileAvailability.PlanLapsed) {
    return <p className="text-xs text-warning">{t('table:field.editor.publicLinks.planLapsed')}</p>;
  }
  // No counts: they come from the cell references, which some writes (a field duplicated with
  // its values) leave out. While the space is paused the links do not open, so it does not read
  // as public; copying and failures still show, as they need a retry once the links are back.
  const paused = status.availability === PublicFileAvailability.Paused;
  const state =
    status.pending > 0
      ? t('table:field.editor.publicLinks.copying')
      : paused
        ? undefined
        : t('table:field.editor.publicLinks.status');
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {paused && <p className="text-warning">{t('table:field.editor.publicLinks.paused')}</p>}
      {(state || status.failed > 0) && (
        <p className="flex flex-wrap items-center gap-x-1">
          {state && <span>{state}</span>}
          {status.failed > 0 && (
            <>
              <span className="text-destructive" title={reasons}>
                {state ? '· ' : ''}
                {t('table:field.editor.publicLinks.failed', { count: status.failed })}
              </span>
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0 text-xs"
                disabled={retrying}
                onClick={onRetry}
              >
                {t('table:field.editor.publicLinks.retry')}
              </Button>
            </>
          )}
        </p>
      )}
    </div>
  );
};

export const AttachmentOptions = (props: {
  options: Partial<IAttachmentFieldOptions> | undefined;
  onChange?: (options: Partial<IAttachmentFieldOptions>) => void;
  isLookup?: boolean;
  /** Set for a field that exists, whose copy progress the settings show. */
  fieldId?: string;
}) => {
  const { isLookup, options, onChange, fieldId } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  // Hidden unless the deployment publishes files, and without usage info (community edition,
  // read-only previews).
  const { data: publicSetting } = usePublicSettingQuery();
  const publicFileEnabled = publicSetting?.publicFileEnabled === true;
  const usage = useBaseUsage();
  const tableId = useTableId();
  // only the v2 engine publishes files: on v1 the switch would save without copying anything
  const onV1 = useBase()?.v2Status?.useV2 === false;
  const queryClient = useQueryClient();
  // An existing field waits for its saved state, so a public one does not flash the notice.
  const savedField = useField(fieldId);
  const savedPublic = fieldId ? savedField && isPublicAttachmentField(savedField) : false;

  const visible = !isLookup && publicFileEnabled && Boolean(usage);
  const statusKey = ReactQueryKeys.publicFileStatus(tableId ?? '', fieldId ?? '');
  const { data: status } = useQuery({
    queryKey: statusKey,
    queryFn: ({ queryKey }) =>
      getPublicFileStatus(queryKey[1], queryKey[2]).then(({ data }) => data),
    // v1 copies nothing, so there is no progress to show
    enabled: visible && !onV1 && savedPublic === true && Boolean(tableId && fieldId),
    refetchInterval: (query) =>
      query.state.data?.pending ? COPYING_POLL_INTERVAL : IDLE_POLL_INTERVAL,
  });
  const { mutate: retry, isPending: retrying } = useMutation({
    mutationFn: () => retryPublicFiles(statusKey[1], statusKey[2]),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  });

  if (!visible) {
    return null;
  }

  const isPublic = Boolean(options?.isPublic);
  const publicFileEnable = usage?.limit?.[UsageFeatureLimit.PublicFileEnable] === true;
  // What saving the draft does, said under the switch until it is saved; the save asks once.
  const turningOn = !onV1 && isPublic && savedPublic === false;
  const turningOff = !onV1 && !isPublic && savedPublic === true;

  const enableNotice = (
    <div className="space-y-1 text-xs">
      <p className="text-warning">{t('table:field.editor.publicLinks.enableDescription')}</p>
      <ul className="list-disc space-y-0.5 ps-4 text-muted-foreground">
        <li>{t('table:field.editor.publicLinks.enableBackground')}</li>
        <li>{t('table:field.editor.publicLinks.enableNoRecall')}</li>
        {publicSetting?.publicFileCreditPerGb !== undefined && (
          <li>
            {t('table:field.editor.publicLinks.enableTraffic', {
              credit: publicSetting.publicFileCreditPerGb,
            })}
          </li>
        )}
      </ul>
    </div>
  );

  // Without the plan the switch is locked behind the upgrade prompt, unless the field is
  // already public: a space that lost the plan can still turn its links off.
  const renderSwitch = (badge: ReactElement | null) => (
    <div className="flex items-start gap-2">
      <Switch
        id="attachment-public-links"
        checked={isPublic}
        disabled={onV1 || (!publicFileEnable && !isPublic)}
        onCheckedChange={(checked) => onChange?.({ ...options, isPublic: checked })}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor="attachment-public-links" className="flex items-center gap-1">
          {t('table:field.editor.publicLinks.label')}
          {/* served through Cloudflare Cloud Connector, still in beta */}
          <span className="h-5 rounded-sm border border-warning p-0.5 text-[11px] font-normal leading-none text-warning">
            {t('common:noun.beta')}
          </span>
          {badge}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t('table:field.editor.publicLinks.description')}
        </p>
        {onV1 && (
          <p className="text-xs text-warning">{t('table:field.editor.publicLinks.legacyEngine')}</p>
        )}
        {/* the progress of what is saved, while the draft still says public */}
        {!onV1 && status?.isPublic && isPublic && (
          <PublicFileStatusLine status={status} retrying={retrying} onRetry={() => retry()} />
        )}
        {turningOn && enableNotice}
        {turningOff && (
          <p className="text-xs text-warning">
            {t('table:field.editor.publicLinks.disableDescription')}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="form-control space-y-4 border-t pt-4">
      {publicFileEnable || isPublic ? (
        renderSwitch(null)
      ) : (
        <UpgradeWrapper targetBillingLevel={BillingProductLevel.Pro}>
          {({ badge }) => renderSwitch(badge)}
        </UpgradeWrapper>
      )}
    </div>
  );
};
