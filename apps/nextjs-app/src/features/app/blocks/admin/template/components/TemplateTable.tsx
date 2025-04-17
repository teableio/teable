import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Trash2, ArrowUp } from '@teable/icons';
import type { ITemplateCoverRo, IUpdateTemplateRo } from '@teable/openapi';
import {
  createTemplateSnapshot,
  deleteTemplate,
  getBaseAll,
  getSpaceList,
  getTemplateList,
  pinTopTemplate,
  updateTemplate,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Spin,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Switch,
} from '@teable/ui-lib';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { BaseSelectPanel } from './BaseSelectPanel';
import { MarkdownEditor } from './MarkdownEditor';
import { TemplateCategorySelect } from './TemplateCategorySelect';
import { TemplateCover } from './TemplateCover';
import { TemplateTooltips } from './TemplateTooltips';
import { TextEditor } from './TextEditor';

export const TemplateTable = () => {
  const { t } = useTranslation('common');

  const env = useEnv();

  const { edition } = env;

  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);

  const { data: templateData } = useQuery({
    queryKey: ReactQueryKeys.templateList(),
    queryFn: () => getTemplateList().then((data) => data.data),
  });

  const { data: baseList } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll().then((data) => data.data),
  });

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const queryClient = useQueryClient();

  const { mutateAsync: deleteTemplateFn } = useMutation({
    mutationFn: (templateId: string) => deleteTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
    },
  });

  const { mutateAsync: createTemplateSnapshotFn, isLoading } = useMutation({
    mutationFn: (templateId: string) => createTemplateSnapshot(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
      setCurrentTemplateId(null);
    },
  });

  const { mutateAsync: updateTemplateFn } = useMutation({
    mutationFn: ({ templateId, updateRo }: { templateId: string; updateRo: IUpdateTemplateRo }) =>
      updateTemplate(templateId, { ...updateRo }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
    },
  });

  const handlePublishTemplate = (templateId: string, isPublished: boolean) => {
    updateTemplateFn({ templateId, updateRo: { isPublished } });
  };

  const onChangeTemplateName = (templateId: string, name: string) => {
    updateTemplateFn({ templateId, updateRo: { name } });
  };

  const onChangeTemplateDescription = (templateId: string, description: string) => {
    updateTemplateFn({ templateId, updateRo: { description } });
  };

  const onChangeTemplateCover = (templateId: string, cover: ITemplateCoverRo | null) => {
    updateTemplateFn({ templateId, updateRo: { cover } });
  };

  const onChangeTemplateCategory = (templateId: string, templateCategoryId: string) => {
    updateTemplateFn({ templateId, updateRo: { categoryId: templateCategoryId } });
  };

  const onChangeTemplateMarkdownDescription = (templateId: string, markdownDescription: string) => {
    updateTemplateFn({ templateId, updateRo: { markdownDescription } });
  };

  const { mutateAsync: pinTopTemplateFn } = useMutation({
    mutationFn: (templateId: string) => pinTopTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
    },
  });

  return (
    <div>
      <Table className="max-h-50 relative size-full scroll-smooth rounded-sm">
        <TableHeader className="z-50 bg-background">
          <TableRow className="sticky top-0 z-10 h-16 border-none bg-background">
            <TableHead>{t('settings.templateAdmin.header.cover')}</TableHead>
            <TableHead className="w-40 shrink-0">
              {t('settings.templateAdmin.header.name')}
            </TableHead>
            <TableHead className="w-52 max-w-52 shrink-0">
              {t('settings.templateAdmin.header.description')}
            </TableHead>
            <TableHead className="w-52 max-w-52 shrink-0">
              {t('settings.templateAdmin.header.markdownDescription')}
            </TableHead>
            <TableHead>{t('settings.templateAdmin.header.category')}</TableHead>
            <TableHead className="min-w-24 text-center">
              {t('settings.templateAdmin.header.isSystem')}
            </TableHead>
            <TableHead className="min-w-24 text-center">
              {t('settings.templateAdmin.header.status')}
            </TableHead>
            <TableHead className="w-32">
              {t('settings.templateAdmin.header.publishSnapshot')}
            </TableHead>
            <TableHead className="min-w-48">
              {t('settings.templateAdmin.header.snapshotTime')}
            </TableHead>
            <TableHead className="text-center">
              {t('settings.templateAdmin.header.source')}
            </TableHead>
            <TableHead>{t('settings.templateAdmin.header.actions')}</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {templateData?.map((row) => (
            <TableRow key={row.id} className="max-h-24">
              <TableCell className="max-w-40">
                <TemplateCover
                  cover={row.cover}
                  onChange={(res) => {
                    onChangeTemplateCover(row.id, res);
                  }}
                />
              </TableCell>
              <TableCell className="max-w-40">
                <TextEditor
                  value={row.name}
                  onChange={(value) => {
                    onChangeTemplateName(row.id, value);
                  }}
                />
              </TableCell>
              <TableCell className="max-w-48">
                <TextEditor
                  value={row.description}
                  onChange={(value) => {
                    onChangeTemplateDescription(row.id, value);
                  }}
                />
              </TableCell>
              <TableCell className="max-w-48">
                <MarkdownEditor
                  value={row.markdownDescription}
                  onChange={(value) => {
                    onChangeTemplateMarkdownDescription(row.id, value);
                  }}
                />
              </TableCell>
              <TableCell>
                <TemplateCategorySelect
                  templateId={row.id}
                  value={row.categoryId}
                  onChange={(name) => onChangeTemplateCategory(row.id, name)}
                />
              </TableCell>
              <TableCell className="text-center align-middle">
                <Checkbox
                  id="terms"
                  defaultChecked={Boolean(row.isSystem)}
                  disabled={edition !== 'CLOUD'}
                />
              </TableCell>
              <TableCell className="text-center align-middle">
                <TemplateTooltips
                  content={t('settings.templateAdmin.tips.needSnapshot')}
                  disabled={!row.snapshot || !row.name || !row.description}
                >
                  <Switch
                    className="scale-80"
                    defaultChecked={Boolean(row.isPublished)}
                    disabled={!row.snapshot || !row.name || !row.description}
                    onCheckedChange={(checked: boolean) => {
                      handlePublishTemplate(row?.id, checked);
                    }}
                  />
                </TemplateTooltips>
              </TableCell>
              <TableCell>
                <TemplateTooltips
                  content={t('settings.templateAdmin.tips.needBaseSource')}
                  disabled={!row.baseId || (edition !== 'CLOUD' && row.isSystem)}
                >
                  <Button
                    variant="outline"
                    size={'xs'}
                    disabled={!row?.baseId}
                    onClick={() => {
                      setCurrentTemplateId(row.id);
                      createTemplateSnapshotFn(row.id);
                    }}
                  >
                    {t('settings.templateAdmin.header.publishSnapshot')}

                    {currentTemplateId === row.id && isLoading && <Spin className="size-4" />}
                  </Button>
                </TemplateTooltips>
              </TableCell>
              <TableCell>
                {row.snapshot?.snapshotTime ? (
                  dayjs(row.snapshot.snapshotTime).format('YYYY-MM-DD HH:mm:ss')
                ) : (
                  <span className="text-gray-500">{t('settings.templateAdmin.noData')}</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <TemplateTooltips
                  content={t('settings.templateAdmin.tips.forbiddenUpdateSystemTemplate')}
                  disabled={(edition !== 'CLOUD' || !edition) && row.isSystem}
                >
                  <BaseSelectPanel
                    disabled={(edition !== 'CLOUD' || !edition) && row.isSystem}
                    baseList={baseList || []}
                    templateId={row.id}
                    baseId={row?.baseId}
                    spaceList={spaceList || []}
                  />
                </TemplateTooltips>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size={'xs'}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-40">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        className="flex items-center gap-2"
                        onClick={() => {
                          pinTopTemplateFn(row.id);
                        }}
                      >
                        <ArrowUp className="size-3.5" />
                        <span className="text-sm">
                          {t('settings.templateAdmin.actions.pinTop')}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="flex items-center gap-2 text-red-500"
                        onClick={() => {
                          deleteTemplateFn(row.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        <span className="text-sm">
                          {t('settings.templateAdmin.actions.delete')}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}

          {templateData?.length === 0 && (
            <TableRow>
              <TableCell colSpan={100} className="h-48 text-center">
                {t('settings.templateAdmin.noData')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};
