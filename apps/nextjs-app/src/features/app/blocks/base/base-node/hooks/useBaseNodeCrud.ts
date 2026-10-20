import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import type {
  IMoveBaseNodeRo,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IUpdateBaseNodeRo,
  IBaseNodeVo,
} from '@teable/openapi';
import {
  BaseNodeResourceType,
  moveBaseNode,
  createBaseNode,
  deleteBaseNode,
  duplicateBaseNode,
  updateBaseNode,
  permanentDeleteBaseNode,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { cleanParentId, getNodeName } from './helper';
import { useBaseNodeContext } from './useBaseNodeContext';

interface IUseBaseNodeCrudOptions {
  onCreateSuccess?: (node: IBaseNodeVo) => void;
  onDuplicateSuccess?: (node: IBaseNodeVo) => void;
  onUpdateSuccess?: (node: IBaseNodeVo) => void;
  onUpdateError?: (error: unknown, variables: { nodeId: string; ro: IUpdateBaseNodeRo }) => void;
  onMoveSuccess?: (node: IBaseNodeVo) => void;
  onMoveError?: (error: unknown, variables: { nodeId: string; ro: IMoveBaseNodeRo }) => void;
  onDeleteSuccess?: (nodeId: string) => void;
}

export const useBaseNodeCrud = (props?: IUseBaseNodeCrudOptions) => {
  const baseId = useBaseId() as string;
  const { t } = useTranslation(['table', 'common']);

  const { treeItems, invalidateMenu } = useBaseNodeContext();
  const queryClient = useQueryClient();
  // Pins carry the node's name and vanish with it.
  const invalidatePins = () =>
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.pinList() });
  // The node's own page caches its name too.
  const invalidateNodeDetail = ({ resourceType, resourceId }: IBaseNodeVo) => {
    switch (resourceType) {
      case BaseNodeResourceType.Dashboard:
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getDashboard(resourceId) });
        break;
      case BaseNodeResourceType.Workflow:
        queryClient.invalidateQueries({
          queryKey: ReactQueryKeys.workflowItem(baseId, resourceId),
        });
        break;
      case BaseNodeResourceType.Routine:
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.routineItem(baseId, resourceId) });
        break;
      case BaseNodeResourceType.App:
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getApp(baseId, resourceId) });
        break;
    }
  };

  const { mutateAsync: createNodeFn } = useMutation({
    mutationFn: (ro: ICreateBaseNodeRo) => createBaseNode(baseId, ro).then((res) => res.data),
    onSuccess: (node) => {
      props?.onCreateSuccess?.(node);
    },
  });

  const { mutateAsync: updateNodeFn } = useMutation({
    mutationFn: ({ nodeId, ro }: { nodeId: string; ro: IUpdateBaseNodeRo }) =>
      updateBaseNode(baseId, nodeId, ro).then((res) => res.data),
    onSuccess: (node) => {
      invalidatePins();
      invalidateNodeDetail(node);
      props?.onUpdateSuccess?.(node);
    },
    onError: (error, variables) => {
      invalidateMenu();
      props?.onUpdateError?.(error, variables);
    },
  });

  const { mutateAsync: duplicateNodeFn } = useMutation({
    mutationFn: ({ nodeId, ro }: { nodeId: string; ro: IDuplicateBaseNodeRo }) =>
      duplicateBaseNode(baseId, nodeId, ro).then((res) => res.data),
    onSuccess: (node) => {
      invalidateMenu();
      props?.onDuplicateSuccess?.(node);
    },
  });

  const { mutateAsync: moveNodeFn } = useMutation({
    mutationFn: ({ nodeId, ro }: { nodeId: string; ro: IMoveBaseNodeRo }) =>
      moveBaseNode(baseId, nodeId, ro).then((res) => res.data),
    onSuccess: (node) => {
      props?.onMoveSuccess?.(node);
    },
    onError: (error, variables) => {
      invalidateMenu();
      props?.onMoveError?.(error, variables);
    },
  });

  const { mutateAsync: deleteNodeFn } = useMutation({
    mutationFn: ({ nodeId, permanent }: { nodeId: string; permanent?: boolean }) =>
      permanent ? permanentDeleteBaseNode(baseId, nodeId) : deleteBaseNode(baseId, nodeId),
    onSuccess: (_, { nodeId }) => {
      props?.onDeleteSuccess?.(nodeId);
      invalidateMenu();
      invalidatePins();
    },
  });

  const createNode = useCallback(
    async (params: ICreateBaseNodeRo) => {
      const { name: rawName, parentId: rawParentId } = params;
      const parentId = cleanParentId(rawParentId);
      const name = rawName ?? t('common:untitled');
      const nodes = Object.values(treeItems);
      await createNodeFn({
        ...params,
        parentId,
        name: getUniqName(
          name,
          nodes.map((node) => getNodeName(node))
        ),
      });
    },
    [createNodeFn, treeItems, t]
  );

  return useMemo(() => {
    return {
      createNode,
      duplicateNode: async (nodeId: string, ro: IDuplicateBaseNodeRo) => {
        return duplicateNodeFn({ nodeId, ro });
      },
      updateNode: async (nodeId: string, ro: IUpdateBaseNodeRo) => {
        return updateNodeFn({ nodeId, ro });
      },
      deleteNode: async (nodeId: string, permanent?: boolean) => {
        return deleteNodeFn({ nodeId, permanent });
      },
      moveNode: async (nodeId: string, ro: IMoveBaseNodeRo) => {
        return moveNodeFn({ nodeId, ro });
      },
    };
  }, [createNode, duplicateNodeFn, updateNodeFn, deleteNodeFn, moveNodeFn]);
};

export type BaseNodeCrudHooks = ReturnType<typeof useBaseNodeCrud>;
