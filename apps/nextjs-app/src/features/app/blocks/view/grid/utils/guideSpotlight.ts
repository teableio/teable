import type { IGuideSpotlightRequest } from '@teable/sdk';

// A request no grid picked up in time (e.g. the table opened in a kanban view) must not
// surprise the user once they later reach a grid.
export const GUIDE_SPOTLIGHT_PENDING_TTL = 20_000;

export type IGuideSpotlightResolution = 'wait' | 'drop' | { columnIndex: number };

interface IResolveGuideSpotlightParams {
  request: IGuideSpotlightRequest;
  tableId: string;
  // table the loaded fields belong to; differs from tableId while switching tables
  fieldsTableId: string | undefined;
  columns: { id?: string }[];
  hasFirstRecord: boolean;
  now: number;
}

export const resolveGuideSpotlight = ({
  request,
  tableId,
  fieldsTableId,
  columns,
  hasFirstRecord,
  now,
}: IResolveGuideSpotlightParams): IGuideSpotlightResolution => {
  if (now - request.requestedAt > GUIDE_SPOTLIGHT_PENDING_TTL) return 'drop';
  if (request.tableId !== tableId || fieldsTableId !== tableId) return 'wait';

  // hidden in this view or deleted
  const columnIndex = columns.findIndex((column) => column.id === request.fieldId);
  if (columnIndex < 0) return 'drop';

  // an empty table keeps waiting until the request expires
  if (!hasFirstRecord) return 'wait';
  return { columnIndex };
};
