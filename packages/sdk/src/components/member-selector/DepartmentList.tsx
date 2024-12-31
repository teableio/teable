import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronRight } from '@teable/icons';
import { getDepartmentList, getDepartmentUsers } from '@teable/openapi';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
  ScrollArea,
  Skeleton,
  cn,
  Button,
} from '@teable/ui-lib';
import * as React from 'react';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import { useOrganization } from '../../hooks';
import { DepartmentItem } from './components/DepartmentItem';
import { UserItem } from './components/UserItem';
import { TreeNodeType } from './types';
import type { DepartmentNode, UserNode, SelectedMember, TreeNode } from './types';
import { useDebounce } from './use-debounce';

interface DepartmentListProps {
  departmentId?: string;
  selectedMembers: SelectedMember[];
  onSelect: (member: TreeNode) => void;
  className?: string;
  search?: string;
  excludeType?: TreeNodeType[];
  disabledDepartment?: boolean;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

const MEMBERS_PER_PAGE = 100;

export function DepartmentList({
  departmentId,
  selectedMembers = [],
  onSelect,
  className,
  search,
  excludeType,
  disabledDepartment,
}: DepartmentListProps) {
  const { t } = useTranslation();
  const [currentDepartment, setCurrentDepartment] = React.useState<string | undefined>(
    departmentId
  );
  const { organization } = useOrganization();
  const [breadcrumbs, setBreadcrumbs] = React.useState<BreadcrumbItem[]>([]);
  const debouncedSearch = useDebounce(search, 300);
  const { data: departments, isLoading: isLoadingDepartments } = useQuery({
    queryKey: ReactQueryKeys.getDepartmentList({
      parentId: currentDepartment,
      search: debouncedSearch,
    }),
    staleTime: 1000,
    queryFn: ({ queryKey: [_, ro] }) =>
      getDepartmentList({
        ...ro,
        parentId: search ? undefined : currentDepartment,
        includeChildrenDepartment: search ? true : ro?.includeChildrenDepartment,
      }).then((res) => res.data),
    enabled: !excludeType?.includes(TreeNodeType.DEPARTMENT),
  });

  const {
    data: members,
    isLoading: isLoadingMembers,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.getDepartmentUsers({
      departmentId: currentDepartment,
      search: debouncedSearch,
    }),
    queryFn: ({ pageParam = 0, queryKey: [_, ro] }) =>
      getDepartmentUsers({
        ...ro,
        departmentId: ro?.search ? undefined : ro?.departmentId,
        includeChildrenDepartment: ro?.search ? true : ro?.includeChildrenDepartment,
        skip: pageParam * MEMBERS_PER_PAGE,
        take: MEMBERS_PER_PAGE,
      }).then((res) => res.data),
    staleTime: 1000,
    refetchOnWindowFocus: false,
    getNextPageParam: (lastPage, pages) => {
      const allUsers = pages.flatMap((page) => page.users);
      return allUsers.length >= lastPage.total ? undefined : pages.length;
    },
    enabled: !excludeType?.includes(TreeNodeType.USER),
  });

  const isLoading = isLoadingDepartments || isLoadingMembers;

  const memberNodes = React.useMemo<UserNode[]>(() => {
    return (
      members?.pages
        .flatMap((page) => page.users)
        .map((member) => ({
          ...member,
          type: TreeNodeType.USER,
        })) ?? []
    );
  }, [members]);

  const departmentNodes = React.useMemo<DepartmentNode[]>(() => {
    return (
      departments?.map((dept) => ({
        ...dept,
        type: TreeNodeType.DEPARTMENT,
      })) ?? []
    );
  }, [departments]);

  const handleBreadcrumbClick = async (index: number) => {
    if (index === -1) {
      setCurrentDepartment(undefined);
      setBreadcrumbs([]);
    } else {
      const item = breadcrumbs[index];
      setBreadcrumbs((prev) => prev.slice(0, index + 1));
      setCurrentDepartment(item.id);
    }
  };

  const isSelected = (id: string): boolean => {
    return selectedMembers.some((member) => member.id === id);
  };

  const handleDepartmentClick = (item: TreeNode) => {
    setBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name }]);
    setCurrentDepartment(item.id);
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <Breadcrumb
        className={cn('bg-background px-4 py-2', {
          'opacity-0': debouncedSearch,
        })}
      >
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink onClick={() => handleBreadcrumbClick(-1)} className="cursor-pointer">
              {organization?.name}
            </BreadcrumbLink>
          </BreadcrumbItem>
          {breadcrumbs.map((item, index) => (
            <React.Fragment key={item.id}>
              <BreadcrumbSeparator>
                <ChevronRight className="size-4" />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                {index === breadcrumbs.length - 1 ? (
                  <BreadcrumbPage>{item.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    onClick={() => handleBreadcrumbClick(index)}
                    className="cursor-pointer"
                  >
                    {item.name}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <ScrollArea className="flex-1 border-t">
        <div className="space-y-2 p-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[52px]" />
              ))}
            </div>
          ) : memberNodes.length === 0 && departmentNodes.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t('memberSelector.empty')}
            </div>
          ) : (
            <>
              {departmentNodes.map((item) => (
                <DepartmentItem
                  key={item.id}
                  name={item.name}
                  checked={isSelected(item.id)}
                  onClick={() => handleDepartmentClick(item)}
                  onCheckedChange={() => onSelect(item)}
                  showCheckbox={!disabledDepartment}
                  suffix={<ChevronRight className="size-4 text-muted-foreground" />}
                />
              ))}

              {memberNodes.map((item) => (
                <UserItem
                  key={item.id}
                  name={item.name}
                  email={item.email}
                  avatar={item.avatar}
                  checked={isSelected(item.id)}
                  onCheckedChange={() => onSelect(item)}
                />
              ))}
              {hasNextPage && (
                <div className="flex justify-center py-4">
                  <Button onClick={() => fetchNextPage()}>{t('common.loadMore')}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
