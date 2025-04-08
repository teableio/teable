import type { NotificationStatesEnum } from '@teable/core';
import { File } from '@teable/icons';
import { type INotificationVo } from '@teable/openapi';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'react-i18next';
// import { useDownload } from '@/features/app/hooks/useDownLoad';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

export const AttachmentNotification = (props: LinkNotificationProps) => {
  const {
    data: { message },
  } = props;

  const { t } = useTranslation(['common']);

  // const content = JSON.parse(message);

  // const { name, previewUrl } = content;

  // const { trigger } = useDownload({ downloadUrl: previewUrl, key: 'downloadExportFile' });

  return (
    <div>
      <span>{t('notification.exportBase.successText')}</span>
      <Button
        variant={'ghost'}
        // onClick={() => trigger?.()}
        className="flex h-8 w-full items-center justify-start gap-1 rounded-sm underline hover:text-blue-500"
      >
        <File className="size-4" />
        {/* <span className="truncate">{name}</span> */}
        <span className="truncate" dangerouslySetInnerHTML={{ __html: message }} />
      </Button>
    </div>
  );
};
