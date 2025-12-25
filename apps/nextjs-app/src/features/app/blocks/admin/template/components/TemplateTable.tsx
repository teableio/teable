import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Trash2, ArrowUp, DraggableHandle, Link } from '@teable/icons';
import type { ITemplateCoverRo, IUpdateTemplateRo } from '@teable/openapi';
import {
  createTemplateSnapshot,
  deleteTemplate,
  getBaseAll,
  getSpaceList,
  getTemplateList,
  pinTopTemplate,
  updateTemplate,
  updateTemplateOrder,
} from '@teable/openapi';
import { ReactQueryKeys, useIsHydrated } from '@teable/sdk';
import {
  Spin,
  Button,
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
  Avatar,
  AvatarImage,
  AvatarFallback,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TooltipPortal,
  cn,
} from '@teable/ui-lib';
import dayjs from 'dayjs';
import { useTranslation } from 'next-i18next';
import { useMemo, useState, useEffect } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { BaseSelectPanel } from './BaseSelectPanel';
import { MarkdownPreviewButton } from './MarkdownPreviewButton';
import { TemplateCategorySelect } from './TemplateCategorySelect';
import { TemplateCover } from './TemplateCover';
import { TemplateTooltips } from './TemplateTooltips';
import { TextEditor } from './TextEditor';
import { TextEditorDialog } from './TextEditorDialog';

const PAGE_SIZE = 10;

export const TemplateTable = () => {
  const { t } = useTranslation(['common']);

  const env = useEnv();

  const { edition } = env;

  const isHydrated = useIsHydrated();

  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.templateList(),
    queryFn: ({ pageParam }) =>
      getTemplateList({
        skip: pageParam ?? 0,
        take: PAGE_SIZE,
      }).then((res) => res.data),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) {
        return undefined;
      }
      return allPages.length * PAGE_SIZE;
    },
  });

  const displayedData = useMemo(() => {
    return data?.pages.flatMap((page) => page) ?? [];
  }, [data]);

  const [innerTemplates, setInnerTemplates] = useState(displayedData);

  useEffect(() => {
    setInnerTemplates(displayedData);
  }, [displayedData]);

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

  const handleFeaturedTemplate = (templateId: string, featured: boolean) => {
    updateTemplateFn({ templateId, updateRo: { featured } });
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

  const onChangeTemplateCategory = (templateId: string, categoryId: string[]) => {
    updateTemplateFn({ templateId, updateRo: { categoryId } });
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

  const { mutateAsync: updateTemplateOrderFn } = useMutation({
    mutationFn: ({
      templateId,
      anchorId,
      position,
    }: {
      templateId: string;
      anchorId: string;
      position: 'before' | 'after';
    }) => updateTemplateOrder({ templateId, anchorId, position }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
    },
  });

  const onDragEnd = async (result: DropResult) => {
    const { source, destination } = result;

    if (!destination || source.index === destination.index) {
      return;
    }

    const list = [...innerTemplates];
    const [template] = list.splice(source.index, 1);
    list.splice(destination.index, 0, template);
    setInnerTemplates(list);

    const templateIndex = list.findIndex((v) => v.id === template.id);
    if (templateIndex === 0) {
      await updateTemplateOrderFn({
        templateId: template.id,
        anchorId: list[1].id,
        position: 'before',
      });
    } else {
      await updateTemplateOrderFn({
        templateId: template.id,
        anchorId: list[templateIndex - 1].id,
        position: 'after',
      });
    }
  };

  const renderTableRow = (row: (typeof innerTemplates)[number]) => {
    return (
      <>
        <TableCell className="max-w-40">
          <TemplateCover
            cover={row.cover}
            onChange={(res) => {
              onChangeTemplateCover(row.id, res);
            }}
          />
        </TableCell>
        <TableCell className="max-w-80">
          <TextEditor
            value={row.name}
            onChange={(value) => {
              onChangeTemplateName(row.id, value);
            }}
            singleLine
            maxLength={50}
          />
        </TableCell>
        <TableCell className="max-w-80">
          <TextEditorDialog
            value={row.description}
            onChange={(value) => {
              onChangeTemplateDescription(row.id, value);
            }}
            title={t('settings.templateAdmin.header.description')}
            maxLines={2}
          />
        </TableCell>
        <TableCell>
          <MarkdownPreviewButton
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
            onChange={(ids) => onChangeTemplateCategory(row.id, ids)}
          />
        </TableCell>
        {/* <TableCell className="text-center align-middle">
          <Checkbox
            id="terms"
            defaultChecked={Boolean(row.isSystem)}
            disabled={edition !== 'CLOUD'}
          />
        </TableCell> */}
        <TableCell className="text-center align-middle">
          <TemplateTooltips
            content={t('settings.templateAdmin.tips.needPublish')}
            disabled={!row.isPublished}
          >
            <div>
              <Switch
                className="scale-80"
                defaultChecked={Boolean(row.featured)}
                disabled={!row.isPublished}
                onCheckedChange={(checked: boolean) => {
                  handleFeaturedTemplate(row?.id, checked);
                }}
              />
            </div>
          </TemplateTooltips>
        </TableCell>
        <TableCell className="text-center align-middle">
          <TemplateTooltips
            content={t('settings.templateAdmin.tips.needSnapshot')}
            disabled={!row.snapshot || !row.name || !row.description}
          >
            <div>
              <Switch
                className="scale-80"
                defaultChecked={Boolean(row.isPublished)}
                disabled={!row.snapshot || !row.name || !row.description}
                onCheckedChange={(checked: boolean) => {
                  handlePublishTemplate(row?.id, checked);
                }}
              />
            </div>
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
          {row.createdBy && row.createdBy.name ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex cursor-pointer items-center gap-2">
                    <Avatar className="size-6">
                      <AvatarImage src={row.createdBy.avatar} alt={row.createdBy.name} />
                      <AvatarFallback className="text-xs">
                        {row.createdBy.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{row.createdBy.name}</span>
                  </div>
                </TooltipTrigger>
                {row.createdBy.email && (
                  <TooltipPortal>
                    <TooltipContent>
                      <p>{row.createdBy.email}</p>
                    </TooltipContent>
                  </TooltipPortal>
                )}
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="text-gray-500">
              {t('settings.templateAdmin.header.userNonExistent')}
            </span>
          )}
        </TableCell>
        <TableCell className="text-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size={'xs'}
                  disabled={!row.snapshot?.baseId}
                  onClick={() => {
                    const defaultUrl = row.publishInfo?.defaultUrl;
                    const url =
                      defaultUrl || (row.snapshot?.baseId ? `/base/${row.snapshot.baseId}` : '');
                    if (url) {
                      window.open(`${window.location.origin}${url}`, '_blank');
                    }
                  }}
                >
                  <Link className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>
                  <p>{t('settings.templateAdmin.actions.viewTemplate')}</p>
                </TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </TooltipProvider>
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
                  <span className="text-sm">{t('settings.templateAdmin.actions.pinTop')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex items-center gap-2 text-red-500"
                  onClick={() => {
                    deleteTemplateFn(row.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  <span className="text-sm">{t('settings.templateAdmin.actions.delete')}</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </>
    );
  };

  return (
    <div>
      <Table className="max-h-50 relative size-full scroll-smooth rounded-sm">
        <TableHeader className="z-50 bg-background">
          <TableRow className="sticky top-0 z-10 h-16 border-none bg-background">
            <TableHead className="w-16"></TableHead>
            <TableHead>{t('settings.templateAdmin.header.cover')}</TableHead>
            <TableHead className="min-w-48 shrink-0">
              {t('settings.templateAdmin.header.name')}
            </TableHead>
            <TableHead className="w-48 shrink-0">
              {t('settings.templateAdmin.header.description')}
            </TableHead>
            <TableHead className="w-32 shrink-0">
              {t('settings.templateAdmin.header.markdownDescription')}
            </TableHead>
            <TableHead>{t('settings.templateAdmin.header.category')}</TableHead>
            {/* <TableHead className="min-w-24 text-center">
              {t('settings.templateAdmin.header.isSystem')}
            </TableHead> */}
            <TableHead className="min-w-24 text-center">
              {t('settings.templateAdmin.header.featured')}
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
            <TableHead className="min-w-32">
              {t('settings.templateAdmin.header.createdBy')}
            </TableHead>
            <TableHead className="text-center">
              {t('settings.templateAdmin.header.preview')}
            </TableHead>
            <TableHead>{t('settings.templateAdmin.header.actions')}</TableHead>
          </TableRow>
        </TableHeader>

        {isHydrated ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="template-list">
              {(droppableProvided) => (
                <TableBody {...droppableProvided.droppableProps} ref={droppableProvided.innerRef}>
                  {innerTemplates?.map((row, index) => (
                    <Draggable key={row.id} draggableId={row.id} index={index}>
                      {(draggableProvided, draggableSnapshot) => (
                        <TableRow
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className={cn('max-h-24', {
                            'opacity-50': draggableSnapshot.isDragging,
                          })}
                        >
                          <TableCell
                            className="w-16 cursor-grab active:cursor-grabbing"
                            {...draggableProvided.dragHandleProps}
                          >
                            <DraggableHandle className="size-4 text-gray-400" />
                          </TableCell>
                          {renderTableRow(row)}
                        </TableRow>
                      )}
                    </Draggable>
                  ))}
                  {droppableProvided.placeholder}
                  {innerTemplates?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={100} className="h-48 text-center">
                        {t('settings.templateAdmin.noData')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <TableBody>
            {innerTemplates?.map((row) => (
              <TableRow key={row.id} className="max-h-24">
                <TableCell className="w-16"></TableCell>
                {renderTableRow(row)}
              </TableRow>
            ))}
            {innerTemplates?.length === 0 && (
              <TableRow>
                <TableCell colSpan={100} className="h-48 text-center">
                  {t('settings.templateAdmin.noData')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        )}
      </Table>

      {/* Load more  */}
      {hasNextPage && (
        <div className="flex justify-center border-t py-4">
          <Button
            variant="ghost"
            size="sm"
            className="flex gap-2 px-4"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? <Spin className="size-4" /> : t('actions.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
};
