import { prismaClient } from '@/backend/config/container.config';
import { fieldService } from './field/field.service';
import { recordService } from './record/record.service';

export async function getTables() {
  const tablesMeta = await prismaClient.tableMeta.findMany({
    orderBy: { order: 'asc' },
  });

  return tablesMeta.map((tableMeta) => ({
    ...tableMeta,
    description: tableMeta.description,
    icon: tableMeta.icon,
  }));
}

export async function getDefaultViewId(tableId: string) {
  return prismaClient.view.findFirstOrThrow({
    where: { tableId },
    select: { id: true },
  });
}

export const getSSRSnapshot = async (tableId: string, _viewId?: string) => {
  let viewId = _viewId;
  if (!_viewId) {
    const view = await prismaClient.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true },
    });
    viewId = view.id;
  }
  const tables = await getTables();
  const fields = await fieldService.getFields(tableId, { viewId });
  const views = await prismaClient.view.findMany({
    where: {
      tableId,
    },
  });
  // const views = viewRaws.map((viewRaw) => createViewInstanceByRaw(viewRaw) as ViewVo);
  const rows = await recordService.getRecords(tableId, {
    viewId,
    skip: 0,
    take: 50,
  });

  return {
    tables,
    fields,
    views,
    rows,
  };
};
