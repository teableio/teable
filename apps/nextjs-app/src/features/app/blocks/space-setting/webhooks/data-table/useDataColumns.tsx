import type { ColumnDef } from '@tanstack/react-table';

import { AlertCircle, Check } from '@teable/icons';
import type { IWebhookVo } from '@teable/openapi';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import type { WebhookEventPayload } from '@/features/tempfile';

interface Props {
  actionChildren?: (id: string, url: string) => React.ReactNode;
}

export function useDataColumns(props: Props) {
  const { actionChildren } = props;
  const { t } = useTranslation(['webhook']);

  return useMemo(() => {
    const data: ColumnDef<IWebhookVo>[] = [
      {
        accessorKey: 'lastStatus',
        header: 'lastStatus',
        cell: ({ row }) => (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  {row.getValue('lastStatus') === 'warning' ? (
                    <AlertCircle className="size-5" />
                  ) : (
                    <Check className="size-5" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {row.getValue('lastStatus') === 'warning'
                    ? 'Last run had a warning.'
                    : 'Last run was successful.'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ),
      },
      {
        accessorKey: 'url',
        header: 'url',
        cell: ({ row }) => {
          return (
            <div className="flex space-x-0">
              <span className="max-w-[500px] truncate font-medium">{row.getValue('url')}</span>
            </div>
          );
        },
      },
      {
        accessorKey: 'events',
        header: 'events',
        cell: ({ row }) => {
          const events = row.getValue<WebhookEventPayload[]>('events');

          const additionalEventsCount = events.length > 2 ? events.length - 2 : 0;

          const displayText = events
            .slice(0, 2)
            .map((event) => t(`${event}.title`))
            .join(', ');

          return (
            <div className="flex space-x-0">
              <span className="max-w-[300px] truncate font-medium">
                {displayText}
                {additionalEventsCount > 0 && ` ${t('moreDesc', { len: additionalEventsCount })}`}
              </span>
            </div>
          );
        },
      },
    ];

    if (actionChildren) {
      data.push({
        accessorKey: 'id',
        header: 'id',
        enableHiding: false,
        cell: ({ row }) => {
          const id = row.getValue<string>('id');
          const url = row.getValue<string>('url');
          return actionChildren(id, url);
        },
      });
    }
    return data;
  }, [actionChildren, t]);
}
