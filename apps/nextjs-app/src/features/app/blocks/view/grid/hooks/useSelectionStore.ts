import type { IFilter, IGroup } from '@teable/core';
import type { IGetRecordsRo, IQueryBaseRo } from '@teable/openapi';
import type { IFieldInstance } from '@teable/sdk/model';
import { useEffect } from 'react';
import { create } from 'zustand';

interface ISelectionStore {
  fields?: IFieldInstance[];
  setFields: (fields: IFieldInstance[] | undefined) => void;
  search?: IQueryBaseRo['search'];
  setSearch: (search: IQueryBaseRo['search']) => void;
  filter?: IFilter;
  setFilter: (filter: IFilter | undefined) => void;
  groupBy?: IGroup;
  setGroupBy: (groupBy: IGroup | undefined) => void;
  personalViewCommonQuery?: IGetRecordsRo;
  setPersonalViewCommonQuery: (personalViewCommonQuery: IGetRecordsRo | undefined) => void;
  collapsedGroupIds?: string[];
  setCollapsedGroupIds: (collapsedGroupIds: string[] | undefined) => void;
}

export const useSelectionStore = create<ISelectionStore>((set) => ({
  setFilter: (filter) => set((state) => ({ ...state, filter })),
  setGroupBy: (groupBy) => set((state) => ({ ...state, groupBy })),
  setPersonalViewCommonQuery: (personalViewCommonQuery) =>
    set((state) => ({ ...state, personalViewCommonQuery })),
  setCollapsedGroupIds: (collapsedGroupIds) => set((state) => ({ ...state, collapsedGroupIds })),
  setSearch: (search) => set((state) => ({ ...state, search })),
  setFields: (fields) => set((state) => ({ ...state, fields })),
}));

export const useSyncSelectionStore = ({
  filter,
  groupBy,
  personalViewCommonQuery,
  collapsedGroupIds,
  search,
  fields,
}: {
  filter?: IFilter;
  groupBy?: IGroup;
  personalViewCommonQuery?: IGetRecordsRo;
  collapsedGroupIds?: string[];
  search?: IQueryBaseRo['search'];
  fields?: IFieldInstance[];
}) => {
  useEffect(() => {
    useSelectionStore.setState({ filter });
  }, [filter]);
  useEffect(() => {
    useSelectionStore.setState({ groupBy });
  }, [groupBy]);
  useEffect(() => {
    useSelectionStore.setState({ personalViewCommonQuery });
  }, [personalViewCommonQuery]);
  useEffect(() => {
    useSelectionStore.setState({ collapsedGroupIds });
  }, [collapsedGroupIds]);
  useEffect(() => {
    useSelectionStore.setState({ search });
  }, [search]);
  useEffect(() => {
    useSelectionStore.setState({ fields });
  }, [fields]);
};
