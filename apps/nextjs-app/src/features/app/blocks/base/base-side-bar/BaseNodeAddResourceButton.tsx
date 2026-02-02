import { getUniqName, ViewType } from '@teable/core';
import { FileCsv, FileExcel, Slack, Table2 } from '@teable/icons';
import type { ICreateBaseNodeRo } from '@teable/openapi';
import { BaseNodeResourceType, SUPPORTEDTYPE } from '@teable/openapi';
import { useTables } from '@teable/sdk';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { TableImport } from '../../import-table';
import { useDefaultFields } from '../../table-list/useAddTable';
import { BaseNodeResourceIconMap, ROOT_ID } from '../base-node/hooks';

interface BaseNodeAddResourceButtonProps {
  parentId?: string;
  canCreateFolder?: boolean;
  canCreateTable?: boolean;
  canCreateDashboard?: boolean;
  canCreateWorkflow?: boolean;
  canCreateApp?: boolean;
  createNode: (params: ICreateBaseNodeRo) => Promise<void>;
  children: React.ReactNode;
}

export const BaseNodeAddResourceButton = (props: BaseNodeAddResourceButtonProps) => {
  const {
    createNode,
    parentId,
    canCreateFolder,
    children,
    canCreateTable,
    canCreateDashboard,
    canCreateWorkflow,
    canCreateApp,
  } = props;
  const { t } = useTranslation(['table', 'common']);
  const [tableImportdialogVisible, setTableImportdialogVisible] = useState(false);
  const [fileType, setFileType] = useState<SUPPORTEDTYPE>(SUPPORTEDTYPE.CSV);
  const importFile = (type: SUPPORTEDTYPE) => {
    setTableImportdialogVisible(true);
    setFileType(type);
  };

  const fieldRos = useDefaultFields();
  const tables = useTables();

  const AddTableMenuItems = () => {
    if (!canCreateTable) return null;
    return (
      <>
        <DropdownMenuItem
          onClick={() => {
            createNode({
              resourceType: BaseNodeResourceType.Table,
              parentId,
              fields: fieldRos,
              views: [{ name: t('view.category.table'), type: ViewType.Grid }],
              name: getUniqName(
                t('table:table.newTableLabel'),
                tables.map((table) => table.name)
              ),
            });
          }}
          className="cursor-pointer"
        >
          <Button variant="ghost" size="xs" className="h-4">
            <Table2 className="size-4" />
            {t('table.operator.createBlank')}
          </Button>
        </DropdownMenuItem>
      </>
    );
  };

  const AddResourceMenuItems = () => {
    const list: Array<{
      resourceType:
        | BaseNodeResourceType.Workflow
        | BaseNodeResourceType.App
        | BaseNodeResourceType.Dashboard
        | BaseNodeResourceType.Folder;
      label: string;
      trailingIcon?: React.ReactNode;
    }> = [];

    if (canCreateWorkflow) {
      list.push({
        resourceType: BaseNodeResourceType.Workflow,
        label: t('common:noun.newAutomation'),
        trailingIcon: <Slack className="size-4" />,
      });
    }
    if (canCreateApp) {
      list.push({
        resourceType: BaseNodeResourceType.App,
        label: t('common:noun.newApp'),
      });
    }
    if (canCreateDashboard) {
      list.push({
        resourceType: BaseNodeResourceType.Dashboard,
        label: t('common:noun.dashboard'),
      });
    }

    if (canCreateFolder) {
      list.push({
        resourceType: BaseNodeResourceType.Folder,
        label: t('common:noun.newFolder'),
      });
    }

    if (list.length === 0) {
      return null;
    }

    return list.map((item) => {
      const { resourceType, label, trailingIcon } = item;
      const IconComponent = BaseNodeResourceIconMap[resourceType];
      return (
        <DropdownMenuItem
          key={resourceType}
          className="flex cursor-pointer items-center"
          onClick={() => {
            createNode({
              resourceType,
              parentId,
              name: label,
            });
          }}
        >
          <Button variant="ghost" size="xs" className="h-4">
            <IconComponent className="size-4" />
            {label}
          </Button>
          {trailingIcon}
        </DropdownMenuItem>
      );
    });
  };

  const ImportTableMenuItems = () => {
    if (!canCreateTable) return null;
    if (parentId && parentId !== ROOT_ID) return null;
    return (
      <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="px-4 text-xs font-normal text-muted-foreground">
          {t('table:import.menu.addFromOtherSource')}
        </DropdownMenuLabel>
        <DropdownMenuItem className="cursor-pointer" onClick={() => importFile(SUPPORTEDTYPE.CSV)}>
          <Button variant="ghost" size="xs" className="h-4">
            <FileCsv className="size-4" />
            {t('table:import.menu.csvFile')}
          </Button>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => importFile(SUPPORTEDTYPE.EXCEL)}
        >
          <Button variant="ghost" size="xs" className="h-4">
            <FileExcel className="size-4" />
            {t('table:import.menu.excelFile')}
          </Button>
        </DropdownMenuItem>
      </>
    );
  };

  return (
    <div className="flex w-full flex-col">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <AddTableMenuItems />
          <AddResourceMenuItems />
          <ImportTableMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>

      {tableImportdialogVisible && (
        <TableImport
          fileType={fileType}
          open={tableImportdialogVisible}
          onOpenChange={(open) => setTableImportdialogVisible(open)}
        />
      )}
    </div>
  );
};
