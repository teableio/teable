import { useMutation } from '@tanstack/react-query';
import { getUniqName } from '@teable/core';
import type {
  IMoveBaseNodeRo,
  ICreateBaseNodeRo,
  IDuplicateBaseNodeRo,
  IUpdateBaseNodeRo,
  BaseNodeResourceType,
} from '@teable/openapi';
import {
  moveBaseNode,
  createBaseNode,
  deleteBaseNode,
  duplicateBaseNode,
  updateBaseNode,
} from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useContext, useMemo } from 'react';
import { BaseNodeContext } from '../BaseNodeContext';
import { cleanParentId, getNodeUrl } from './helper';

export const useBaseNodeCrud = () => {
  const baseId = useBaseId() as string;
  const { t } = useTranslation(['table', 'common']);
  const router = useRouter();

  const { invalidateMenu, treeItems } = useContext(BaseNodeContext);

  const createSuccefulyCallback = useCallback(
    async ({
      resourceType,
      resourceId,
    }: {
      resourceType: BaseNodeResourceType;
      resourceId: string;
    }) => {
      const url = getNodeUrl({
        baseId,
        resourceType,
        resourceId,
      });
      router.push(url, undefined, { shallow: true });
      invalidateMenu();
    },
    [baseId, router, invalidateMenu]
  );

  const duplicateSuccefulyCallback = useCallback(
    async ({
      resourceType,
      resourceId,
    }: {
      resourceType: BaseNodeResourceType;
      resourceId: string;
    }) => {
      const url = getNodeUrl({
        baseId,
        resourceType,
        resourceId,
      });
      router.push(url, undefined, { shallow: true });
    },
    [baseId, router]
  );

  const { mutateAsync: createNodeFn } = useMutation({
    mutationFn: (ro: ICreateBaseNodeRo) => createBaseNode(baseId, ro).then((res) => res.data),
    onSuccess: ({ resourceId, resourceType }) =>
      createSuccefulyCallback({
        resourceType,
        resourceId,
      }),
  });

  const { mutateAsync: updateNodeFn } = useMutation({
    mutationFn: ({ nodeId, ro }: { nodeId: string; ro: IUpdateBaseNodeRo }) =>
      updateBaseNode(baseId, nodeId, ro).then((res) => res.data),
    onSuccess: () => invalidateMenu(),
  });

  const { mutateAsync: duplicateNodeFn } = useMutation({
    mutationFn: ({ nodeId, ro }: { nodeId: string; ro: IDuplicateBaseNodeRo }) =>
      duplicateBaseNode(baseId, nodeId, ro).then((res) => res.data),
    onSuccess: ({ resourceId, resourceType }) =>
      duplicateSuccefulyCallback({
        resourceType,
        resourceId,
      }),
  });

  const { mutateAsync: moveNodeFn } = useMutation({
    mutationFn: ({ nodeId, ro }: { nodeId: string; ro: IMoveBaseNodeRo }) =>
      moveBaseNode(baseId, nodeId, ro).then((res) => res.data),
    onSuccess: () => invalidateMenu(),
  });

  const { mutateAsync: deleteNodeFn } = useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      deleteBaseNode(baseId, nodeId).then((res) => res.data),
    onSuccess: () => invalidateMenu(),
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
          nodes.map((node) => node.name)
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
      deleteNode: async (nodeId: string) => {
        return deleteNodeFn({ nodeId });
      },
      moveNode: async (nodeId: string, ro: IMoveBaseNodeRo) => {
        return moveNodeFn({ nodeId, ro });
      },
    };
  }, [createNode, duplicateNodeFn, updateNodeFn, deleteNodeFn, moveNodeFn]);
};

export type BaseNodeCrudHooks = ReturnType<typeof useBaseNodeCrud>;
