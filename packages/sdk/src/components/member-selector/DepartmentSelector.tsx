/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useQuery } from '@tanstack/react-query';
import type { IGetDepartmentListVo, IGetDepartmentVo } from '@teable/openapi';
import { getDepartmentList } from '@teable/openapi';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  cn,
  Dialog,
  DialogContent,
  DialogTrigger,
  ScrollArea,
} from '@teable/ui-lib';
import { ChevronRight } from 'lucide-react';
import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import { useOrganization } from '../../hooks';
import { DepartmentItem } from './components/DepartmentItem';
import { SearchInput } from './SearchInput';

interface BreadcrumbItem {
  id: string;
  name: string;
}

interface IDepartmentSelectorProps {
  title?: React.ReactNode;
  onSelect: (departmentId: string, department: IGetDepartmentVo) => void;
  children?: React.ReactNode;
  calcDisabled?: (department: IGetDepartmentVo) => { clickable?: boolean; selectable?: boolean };
}

const defaultCalcDisabled = {
  clickable: true,
  selectable: true,
};

export interface IDepartmentSelectorRef {
  open: () => void;
  close: () => void;
}

export const DepartmentSelector = forwardRef<IDepartmentSelectorRef, IDepartmentSelectorProps>(
  (props: IDepartmentSelectorProps, ref) => {
    const { onSelect, children, calcDisabled, title } = props;
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();
    const [departmentId, setDepartmentId] = useState<string | undefined>(undefined);
    const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
    const { organization } = useOrganization();
    const [search, setSearch] = useState('');

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
    }));

    const { data: departments, isLoading } = useQuery({
      queryKey: ReactQueryKeys.getDepartmentList({ parentId: departmentId, search }),
      queryFn: ({ queryKey }) =>
        getDepartmentList({
          ...queryKey[1],
        }).then((res) => res.data),
    });

    const reset = () => {
      setBreadcrumbs([]);
      setDepartmentId(undefined);
    };

    const handleBreadcrumbClick = async (index: number) => {
      if (index === -1) {
        reset();
      } else {
        const item = breadcrumbs[index];
        setBreadcrumbs((prev) => prev.slice(0, index + 1));
        setDepartmentId(item.id);
      }
    };

    const handleDepartmentClick = (item: IGetDepartmentListVo[number]) => {
      setBreadcrumbs((prev) => [...prev, { id: item.id, name: item.name }]);
      setDepartmentId(item.id);
    };
    return (
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) {
            reset();
          }
          setOpen(open);
        }}
      >
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent>
          <div className="flex h-96 flex-col gap-4">
            {title}
            <SearchInput
              className="w-full"
              search={search}
              placeholder={t('memberSelector.departmentSelectorSearchPlaceholder')}
              onSearch={setSearch}
            />
            <Breadcrumb className="border-b bg-background px-4 pb-2">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    onClick={() => handleBreadcrumbClick(-1)}
                    className="cursor-pointer"
                  >
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
            <ScrollArea className="flex-1">
              <div className="space-y-2 px-4">
                {departments?.length === 0 && !isLoading && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    {t('memberSelector.emptyDepartment')}
                  </div>
                )}
                <>
                  {departments?.map((item) => {
                    const { clickable, selectable } = calcDisabled?.(item) ?? defaultCalcDisabled;
                    return (
                      <div className="relative" key={item.id}>
                        <DepartmentItem
                          className={cn({
                            'bg-accent pointer-events-none': !selectable,
                          })}
                          name={item.name}
                          checked={false}
                          onClick={() => {
                            if (!selectable) {
                              return;
                            }
                            onSelect(item.id, item);
                            reset();
                            setOpen(false);
                          }}
                          showCheckbox={false}
                        />
                        {item.hasChildren && clickable && (
                          <button
                            className="absolute right-0 top-0 z-10 flex h-full w-8 items-center justify-center rounded-r-lg border bg-background hover:bg-accent"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDepartmentClick(item);
                            }}
                            tabIndex={-1}
                          >
                            <ChevronRight className="size-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);

DepartmentSelector.displayName = 'DepartmentSelector';
