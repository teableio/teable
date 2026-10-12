import { Injectable, Logger } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import type { IOtOperation } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  ProjectionHandler,
  TablePropertiesUpdated,
  TableRenamed,
  ok,
  type DomainError,
  type IEventHandler,
  type IExecutionContext,
  type Result,
  type TableProperties,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import type { IRawOp, IRawOpMap } from '../../share-db/interface';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from './v2-projection-registrar';

/** The table properties that live on the `tbl` doc, and how each reads off the value object. */
const DOC_PROPERTIES: ReadonlyArray<{
  key: 'description' | 'icon';
  read: (properties: TableProperties) => string | null;
}> = [
  { key: 'description', read: (properties) => properties.description() ?? null },
  { key: 'icon', read: (properties) => properties.icon() ?? null },
];

/**
 * The ops a properties change means for the table's ShareDB doc: one `oi`/`od` per property
 * that actually changed, the shape the legacy `tableService.updateTable` emits.
 */
export function tablePropertiesDocOps(
  previous: TableProperties,
  next: TableProperties
): IOtOperation[] {
  return DOC_PROPERTIES.flatMap(({ key, read }) => {
    const before = read(previous);
    const after = read(next);
    return before === after ? [] : [{ p: [key], oi: after, od: before }];
  });
}

/** What a V2 table update means for its doc: a rename moves `name`, a properties update the rest. */
export function tableDocOps(event: TablePropertiesUpdated | TableRenamed): IOtOperation[] {
  if (event instanceof TableRenamed) {
    const before = event.previousName.toString();
    const after = event.nextName.toString();
    return before === after ? [] : [{ p: ['name'], oi: after, od: before }];
  }
  return tablePropertiesDocOps(event.previousProperties, event.nextProperties);
}

/**
 * Keeps the live table doc in step with a V2 rename or properties update.
 *
 * The legacy path writes `table_meta` and, in the same breath, an op for the `tbl_<baseId>`
 * ShareDB doc, which is what every open page reads `table.name` / `table.description` /
 * `table.icon` from. V2's commands write the row and raise `TableRenamed` /
 * `TablePropertiesUpdated`, and nothing turned those into a doc op: a description saved from
 * the table page came back empty the moment the dialog was reopened, and a renamed table kept
 * its old name in the page header, because the doc still held the old values (the mobile
 * app, which has no inline editors keeping the text on screen, showed it first).
 *
 * The doc's version is `table_meta.version`, which V2 leaves alone for these updates, so
 * this bumps it the way the legacy path does — op at the old version, row at the new — and
 * publishes straight to ShareDB: a projection runs after the command's transaction, so there
 * is no Prisma transaction hook left to flush a queued op map.
 */
@ProjectionHandler(TablePropertiesUpdated)
@ProjectionHandler(TableRenamed)
export class V2TablePropertiesDocProjection
  implements IEventHandler<TablePropertiesUpdated | TableRenamed>
{
  private readonly logger = new Logger(V2TablePropertiesDocProjection.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async handle(
    _context: IExecutionContext,
    event: TablePropertiesUpdated | TableRenamed
  ): Promise<Result<void, DomainError>> {
    const ops = tableDocOps(event);
    if (!ops.length) return ok(undefined);

    const tableId = event.tableId.toString();
    const baseId = event.baseId.toString();
    const prisma = this.prismaService.txClient();
    const row = await prisma.tableMeta.findFirst({
      where: { id: tableId, baseId, deletedTime: null },
      select: { version: true },
    });
    if (!row) return ok(undefined);

    await prisma.tableMeta.update({ where: { id: tableId }, data: { version: row.version + 1 } });

    if (this.shareDbService.shareDbAdapter.closed) return ok(undefined);
    const rawOp: IRawOp = {
      src: this.cls.getId() || 'v2-table-properties',
      seq: 1,
      m: { ts: Date.now() },
      op: ops,
      v: row.version,
    };
    const rawOpMap: IRawOpMap = { [`${IdPrefix.Table}_${baseId}`]: { [tableId]: rawOp } };
    try {
      await this.shareDbService.publishOpsMap([rawOpMap]);
    } catch (error) {
      // The row is right; only the live doc missed the change until the next load.
      this.logger.error(`Failed to publish table properties op: tableId=${tableId}`, error);
    }
    return ok(undefined);
  }
}

@V2ProjectionRegistrar()
@Injectable()
export class V2TablePropertiesCompatService implements IV2ProjectionRegistrar {
  private readonly logger = new Logger(V2TablePropertiesCompatService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  registerProjections(container: DependencyContainer): void {
    this.logger.log('Registering V2 table properties compatibility projection');
    container.registerInstance(
      V2TablePropertiesDocProjection,
      new V2TablePropertiesDocProjection(this.prismaService, this.shareDbService, this.cls)
    );
  }
}
