import { Database } from '@teable/icons';
import {
  Badge,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

// Shared badge for principals holding base-level grants; `label` carries the
// full explanation shown in the tooltip. The default renders a bordered
// "[icon] Base · N" badge for management tables; `compact` renders a
// borderless muted "[icon] N" hint so narrow browse lists (e.g. the sidebar)
// keep their visual weight on the names.
export const BaseCountBadge = ({
  count,
  label,
  compact,
}: {
  count: number;
  label: string;
  compact?: boolean;
}) => {
  const { t } = useTranslation('common');
  const content = compact ? (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-normal text-muted-foreground">
      <Database className="size-3.5" aria-hidden="true" />
      {count}
    </span>
  ) : (
    <span className="inline-flex shrink-0">
      <Badge
        variant="outline"
        className="h-5 gap-1 rounded-sm border px-1.5 py-0 text-xs font-normal leading-5 text-muted-foreground"
      >
        <Database className="size-3.5" aria-hidden="true" />
        {t('noun.base')} · {count}
      </Badge>
    </span>
  );
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
