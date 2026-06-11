import { useTranslation } from 'next-i18next';
import type { IBaseShareData } from './BaseShareContent';

export const useBaseSharePermissionOptions = ({
  share,
  onUpdate,
  showEdit = true,
}: {
  share: IBaseShareData | null | undefined;
  onUpdate: (data: Record<string, unknown>) => void;
  showEdit?: boolean;
}) => {
  const { t } = useTranslation(['common']);

  if (!share) return [];

  return [
    {
      active: !share.allowSave && !share.allowEdit,
      label: t('baseShare.linkHolderCanView'),
      desc: t('baseShare.linkHolderCanViewDesc'),
      onClick: () => onUpdate({ allowSave: false, allowEdit: false }),
    },
    showEdit && {
      active: !!share.allowEdit,
      label: t('baseShare.linkHolderCanEdit'),
      desc: t('baseShare.linkHolderCanEditDesc'),
      onClick: () => onUpdate({ allowEdit: true, allowSave: false }),
    },
    {
      active: !!share.allowSave,
      label: t('baseShare.linkHolderCanCopyAndSave'),
      desc: t('baseShare.linkHolderCanCopyAndSaveDesc'),
      onClick: () => onUpdate({ allowSave: true, allowEdit: false }),
    },
  ].filter((item): item is Exclude<typeof item, false> => Boolean(item));
};
