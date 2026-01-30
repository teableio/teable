import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Trash2, ArrowUp, DraggableHandle, Link } from '@teable/icons';
import type { ITemplateCoverRo, IUpdateTemplateRo } from '@teable/openapi';
import {
  deleteTemplate,
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
import { CategorySettingDialog } from './CategorySettingDialog';
import { MarkdownPreviewButton } from './MarkdownPreviewButton';
import { TemplateCategorySelect } from './TemplateCategorySelect';
import { TemplateCover } from './TemplateCover';
import { TemplateTooltips } from './TemplateTooltips';
import { TextEditor } from './TextEditor';
import { TextEditorDialog } from './TextEditorDialog';

const PAGE_SIZE = 20;

export const TemplateTable = () => {
  const { t } = useTranslation(['common']);

  const isHydrated = useIsHydrated();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ReactQueryKeys.templateList(),
    queryFn: ({ pageParam }) =>
      getTemplateList({
        skip: pageParam,
        take: PAGE_SIZE,
      }).then((res) => res.data),
    initialPageParam: 0,
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

  const queryClient = useQueryClient();

  const { mutateAsync: deleteTemplateFn } = useMutation({
    mutationFn: (templateId: string) => deleteTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateList() });
    },
  });

  const { mutateAsync: updateTemplateFn } = useMutation({
    mutationFn: ({ templateId, updateRo }: { templateId: string; updateRo: IUpdateTemplateRo }) =>
      updateTemplate(templateId, { ...updateRo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateList() });
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
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateList() });
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
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateList() });
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
        <TableCell
          className="sticky left-16 w-[140px] min-w-[140px] bg-background"
          style={{ zIndex: 2 }}
        >
          <TemplateCover
            cover={row.cover}
            onChange={(res) => {
              onChangeTemplateCover(row.id, res);
            }}
          />
        </TableCell>
        <TableCell
          className="sticky left-[204px] min-w-48 bg-background after:pointer-events-none after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-border after:content-['']"
          style={{ zIndex: 2 }}
        >
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
          {row.snapshot?.snapshotTime ? (
            dayjs(row.snapshot.snapshotTime).format('YYYY-MM-DD HH:mm:ss')
          ) : (
            <span className="text-gray-500">{t('settings.templateAdmin.noData')}</span>
          )}
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
        <TableCell
          className="sticky bg-background text-center before:pointer-events-none before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-border before:content-['']"
          style={{ zIndex: 2, right: 144, width: 100, minWidth: 100, maxWidth: 100 }}
        >
          {row.usageCount ?? 0}/{row.visitCount ?? 0}
        </TableCell>
        <TableCell
          className="sticky bg-background text-center"
          style={{ zIndex: 2, right: 72, width: 72, minWidth: 72, maxWidth: 72 }}
        >
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
        <TableCell
          className="sticky bg-background"
          style={{ zIndex: 2, right: 0, width: 72, minWidth: 72, maxWidth: 72 }}
        >
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
    <div className="h-full overflow-auto">
      <Table className="relative w-max min-w-full scroll-smooth rounded-sm">
        <TableHeader className="sticky top-0 z-20 bg-background after:pointer-events-none after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:bg-border after:content-['']">
          <TableRow className="h-16 bg-background" style={{ zIndex: 2 }}>
            <TableHead
              className="sticky left-0 w-16 min-w-16 bg-background"
              style={{ zIndex: 3 }}
            ></TableHead>
            <TableHead
              className="sticky left-16 w-[140px] min-w-[140px] bg-background"
              style={{ zIndex: 3 }}
            >
              {t('settings.templateAdmin.header.cover')}
            </TableHead>
            <TableHead
              className="sticky left-[204px] min-w-48 shrink-0 bg-background after:pointer-events-none after:absolute after:right-0 after:top-0 after:h-full after:w-px after:bg-border after:content-['']"
              style={{ zIndex: 3 }}
            >
              {t('settings.templateAdmin.header.name')}
            </TableHead>
            <TableHead className="min-w-48 shrink-0">
              {t('settings.templateAdmin.header.description')}
            </TableHead>
            <TableHead className="w-32 shrink-0">
              {t('settings.templateAdmin.header.markdownDescription')}
            </TableHead>
            <TableHead className="min-w-32">
              <div className="flex items-center justify-between">
                {t('settings.templateAdmin.header.category')}
                <CategorySettingDialog />
              </div>
            </TableHead>
            <TableHead className="min-w-24 text-center">
              {t('settings.templateAdmin.header.featured')}
            </TableHead>
            <TableHead className="min-w-24 text-center">
              {t('settings.templateAdmin.header.status')}
            </TableHead>
            <TableHead className="min-w-48">
              {t('settings.templateAdmin.header.snapshotTime')}
            </TableHead>
            <TableHead className="min-w-32">
              {t('settings.templateAdmin.header.createdBy')}
            </TableHead>
            <TableHead
              className="sticky bg-background text-center before:pointer-events-none before:absolute before:left-0 before:top-0 before:h-full before:w-px before:bg-border before:content-['']"
              style={{ zIndex: 3, right: 144, width: 100, minWidth: 100, maxWidth: 100 }}
            >
              {t('settings.templateAdmin.header.usage')}/{t('settings.templateAdmin.header.visit')}
            </TableHead>
            <TableHead
              className="sticky bg-background text-center"
              style={{ zIndex: 3, right: 72, width: 72, minWidth: 72, maxWidth: 72 }}
            >
              {t('settings.templateAdmin.header.preview')}
            </TableHead>
            <TableHead
              className="sticky bg-background"
              style={{ zIndex: 3, right: 0, width: 72, minWidth: 72, maxWidth: 72 }}
            >
              {t('settings.templateAdmin.header.actions')}
            </TableHead>
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
                            className="sticky left-0 w-16 min-w-16 cursor-grab bg-background active:cursor-grabbing"
                            style={{ zIndex: 2 }}
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
                <TableCell
                  className="sticky left-0 w-16 min-w-16 bg-background"
                  style={{ zIndex: 2 }}
                ></TableCell>
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
