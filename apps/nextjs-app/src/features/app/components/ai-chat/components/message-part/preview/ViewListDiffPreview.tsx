import { useQuery } from '@tanstack/react-query';
import type { IViewOptions, IViewVo } from '@teable/core';
import { ViewType } from '@teable/core';
import { Lock } from '@teable/icons';
import type { IToolInvocationUIPart } from '@teable/openapi';
import { getViewList, McpToolInvocationName } from '@teable/openapi';
import { hexToRGBA } from '@teable/sdk/components';
import { VIEW_ICON_MAP } from '@teable/sdk/components/view/constant';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button } from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { IToolMessagePart } from '../ToolMessagePart';
import { PreviewActionColorMap } from './constant';

interface IViewListPreviewProps {
  toolInvocation: IToolMessagePart['part']['toolInvocation'];
}

const ViewItem = (props: {
  id: string;
  name: string;
  type: ViewType;
  isLocked?: boolean;
  options?: IViewOptions;
  style?: React.CSSProperties;
  changeViewIdId?: string;
  views: {
    id: string;
    name: string;
    type: ViewType;
    isLocked?: boolean;
    options?: IViewOptions;
    style?: React.CSSProperties;
  }[];
}) => {
  const { id, name, type, isLocked, style, options, changeViewIdId, views } = props;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!changeViewIdId) {
      return;
    }
    if (ref.current && id === changeViewIdId) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [changeViewIdId, id]);
  const ViewIcon = VIEW_ICON_MAP[type];
  const router = useRouter();
  const baseId = router.query.baseId as string;
  const tableId = router.query.tableId as string;
  const currentViewId = router.query.viewId as string;

  const isExpired = !views.find((view) => view.id === id);

  console.log('ViewItemViewItemViewItem', views, currentViewId);

  return (
    <Button
      style={style}
      variant="ghost"
      className={
        'flex h-7 min-w-20 shrink-0 items-center gap-2 overflow-hidden rounded border p-1 text-foreground'
      }
      ref={ref}
      disabled={isExpired}
      onClick={() => {
        if (isExpired || id === currentViewId) {
          return;
        }

        router.push(
          {
            pathname: `/base/[baseId]/[tableId]/[viewId]`,
            query: {
              baseId,
              tableId,
              viewId: id,
            },
          },
          undefined,
          {
            shallow: Boolean(id),
          }
        );
      }}
    >
      {type === ViewType.Plugin ? (
        <Image
          className="mr-1 size-4 shrink-0"
          width={16}
          height={16}
          src={(options as IViewOptions & { pluginLogo: string })?.pluginLogo}
          alt={name}
        />
      ) : (
        <Fragment>
          {isLocked && <Lock className="mr-[2px] size-4 shrink-0" />}
          <ViewIcon className="mr-1 size-4 shrink-0" />
        </Fragment>
      )}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <div className="truncate text-xs font-medium leading-5">{name}</div>
      </div>
    </Button>
  );
};

export const ViewListDiffPreview = (props: IViewListPreviewProps) => {
  const { toolInvocation } = props;

  const tableId = toolInvocation?.args?.tableId;

  const { data: views = [] as IViewVo[] } = useQuery({
    queryKey: ReactQueryKeys.viewList(tableId),
    queryFn: () => getViewList(tableId).then((res) => res.data),
    enabled: !!tableId && toolInvocation.toolName !== McpToolInvocationName.CreateView,
  });

  const changeViewIdId = useMemo(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.CreateView: {
        const resultString = (toolInvocation as unknown as IToolInvocationUIPart['toolInvocation'])
          ?.result?.content?.[0]?.text;
        try {
          const result = JSON.parse(resultString);
          return result?.view?.id;
        } catch (err) {
          console.error('createView parse error', err);
          return null;
        }
      }
      case McpToolInvocationName.UpdateViewName:
      case McpToolInvocationName.DeleteView: {
        const { viewId } = toolInvocation.args;
        return viewId;
      }
      default: {
        return null;
      }
    }
  }, [toolInvocation]);

  const viewList = useMemo<
    {
      id: string;
      name: string;
      type: ViewType;
      isLocked?: boolean;
      options?: IViewOptions;
      style?: React.CSSProperties;
    }[]
  >(() => {
    switch (toolInvocation.toolName) {
      case McpToolInvocationName.CreateView: {
        const resultString = (toolInvocation as unknown as IToolInvocationUIPart['toolInvocation'])
          ?.result?.content?.[0]?.text;
        try {
          const result = JSON.parse(resultString);
          const createdView = result?.view;
          return [
            {
              id: createdView.id,
              name: createdView.name,
              type: createdView.type,
              isLocked: createdView.isLocked,
              style: {
                backgroundColor: hexToRGBA(PreviewActionColorMap['create'], 0.5),
                borderColor: PreviewActionColorMap['create'],
              },
            },
          ];
        } catch (err) {
          console.error('createView parse error', err);
          return [];
        }
      }
      case McpToolInvocationName.UpdateViewName: {
        const { viewId, updateViewNameRo } = toolInvocation.args;
        const { name: newName } = updateViewNameRo;
        return views.map((view) => ({
          id: view.id,
          name: viewId === view.id ? newName : view.name,
          type: view.type,
          isLocked: view.isLocked,
          options: view.options,
          style:
            viewId === view.id
              ? {
                  backgroundColor: hexToRGBA(PreviewActionColorMap['update'], 0.5),
                  borderColor: hexToRGBA(PreviewActionColorMap['update'], 0.5),
                }
              : undefined,
        }));
      }
      case McpToolInvocationName.DeleteView: {
        return views.map((view) => {
          const style =
            changeViewIdId === view.id
              ? {
                  backgroundColor: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
                  borderColor: hexToRGBA(PreviewActionColorMap['delete'], 0.5),
                }
              : undefined;
          return {
            id: view.id,
            name: view.name,
            type: view.type,
            isLocked: view.isLocked,
            options: view.options,
            style,
          };
        });
      }
      default: {
        return views.map((view) => ({
          id: view.id,
          name: view.name,
          type: view.type,
          isLocked: view.isLocked,
          options: view.options,
        }));
      }
    }
  }, [toolInvocation, views, changeViewIdId]);

  return (
    <div className="flex gap-2 overflow-x-auto p-2">
      {viewList.map((view) => (
        <ViewItem key={view.id} {...view} changeViewIdId={changeViewIdId} views={viewList} />
      ))}
    </div>
  );
};
