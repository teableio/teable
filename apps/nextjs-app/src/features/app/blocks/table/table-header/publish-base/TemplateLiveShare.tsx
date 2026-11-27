import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getTemplateByBaseId, isTemplateLive, ShortLinkType } from '@teable/openapi';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useContext } from 'react';
import { TemplateHostContext } from '@/features/app/components/space/template/host-context';
import { useShortLink } from '@/features/app/hooks/useShortLink';
import { TemplateLiveActions } from './TemplateSubmissionState';

const templateByBaseKey = (baseId: string) => ['template-by-base', baseId];

/** A project's template as the publish tab reads it, so publishing or withdrawing there shows here. */
export const useBaseTemplate = (baseId: string) =>
  useQuery({
    queryKey: templateByBaseKey(baseId),
    queryFn: () => getTemplateByBaseId(baseId).then((res) => res.data),
  });

/** Withdraws the project's template, where the host can, and reads the listing again. */
export const useWithdrawTemplate = (baseId: string) => {
  const { t } = useTranslation('space');
  const queryClient = useQueryClient();
  const { submission } = useContext(TemplateHostContext);
  return useMutation({
    mutationFn: (templateId: string) => submission!.withdraw(templateId),
    onSuccess: () => {
      toast.success(t('publishBase.review.withdrawn'));
      void queryClient.invalidateQueries({ queryKey: templateByBaseKey(baseId) });
    },
  });
};

/**
 * A project's published template, to share: its link and the share buttons. Nothing until it is
 * live.
 */
export const TemplateLiveShare = ({
  baseId,
  className,
}: {
  baseId: string;
  className?: string;
}) => {
  const { data: template } = useBaseTemplate(baseId);
  const live = isTemplateLive(template);
  // The short link when there is one; the actions fall back to the /t permalink meanwhile.
  const { shortUrl } = useShortLink(
    live && template?.id ? { type: ShortLinkType.Template, resourceId: template.id } : undefined
  );
  if (!live || !template) return null;
  return (
    <div className={className}>
      <TemplateLiveActions template={template} shareUrl={shortUrl} />
    </div>
  );
};
