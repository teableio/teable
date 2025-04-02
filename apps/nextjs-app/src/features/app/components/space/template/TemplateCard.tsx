import { useMutation } from '@tanstack/react-query';
import type { ITemplateVo } from '@teable/openapi';
import { createBaseFromTemplate } from '@teable/openapi';
import { Button, useToast } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import { useSpaceId } from './hooks/use-space-id';

interface ITemplateCardProps {
  template: ITemplateVo;
}

export const TemplateCard = ({ template }: ITemplateCardProps) => {
  const { name, description, cover, usageCount, id: templateId } = template;
  const { presignedUrl } = cover ?? {};
  const { t } = useTranslation('common');
  const router = useRouter();
  const spaceId = useSpaceId();
  const { toast } = useToast();

  const { mutateAsync: createTemplateToBase } = useMutation({
    mutationFn: () =>
      createBaseFromTemplate({
        spaceId: spaceId as string,
        templateId,
        withRecords: true,
      }),
    onSuccess: (res) => {
      const { id: baseId } = res.data;
      router.push(`/base/${baseId}`);
    },
  });

  return (
    <div className="group relative flex h-[306px] w-[300px] cursor-pointer flex-col rounded-sm border p-0 hover:shadow-md">
      <div className="h-48 w-full shrink-0 bg-secondary">
        {presignedUrl && (
          <img src={presignedUrl} className="size-full object-contain" alt="preview" />
        )}
      </div>
      <div className="relative flex w-full flex-1 flex-col items-start gap-1 px-4 py-2 text-sm">
        <div className="h-4 shrink-0 font-medium">{name}</div>
        <div
          className="line-clamp-3 text-wrap text-start text-xs text-gray-500"
          title={description}
        >
          {description}
        </div>
        <div className="absolute bottom-0 left-0 w-full rounded-b-sm bg-gray-50 px-4 py-1.5 text-xs text-gray-500">
          {t('settings.templateAdmin.usageCount', { count: usageCount })}
        </div>
      </div>

      <div className="absolute bottom-0 z-10 hidden w-full justify-around bg-secondary p-2 opacity-80 group-hover:flex">
        {/* <Button variant={'outline'} size={'sm'} className="w-24">
          {t('settings.templateAdmin.actions.preview')}
        </Button> */}
        <Button
          variant={'outline'}
          size={'sm'}
          className="w-24"
          onClick={() => {
            spaceId && createTemplateToBase();
            toast({
              title: t('settings.templateAdmin.importing'),
            });
          }}
        >
          {t('settings.templateAdmin.actions.use')}
        </Button>
      </div>
    </div>
  );
};
