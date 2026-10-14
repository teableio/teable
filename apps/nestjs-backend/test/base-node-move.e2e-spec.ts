/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IBaseNodeVo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  MoveBaseNodeBlockerCode,
  TrashType,
  createBase,
  createBaseNode,
  createSpace as apiCreateSpace,
  deleteField,
  getBaseNodeList,
  getTrashItems,
  installViewPlugin,
  moveBaseNode,
  moveBaseNodeCheck,
  permanentDeleteSpace as apiPermanentDeleteSpace,
  restoreTrash,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import {
  createField,
  createRecords,
  deleteTable,
  getFields,
  getRecords,
  getTable,
  initApp,
  permanentDeleteBase,
  updateRecord,
} from './utils/init-app';

const nodeOf = (nodes: IBaseNodeVo[], resourceId: string) =>
  nodes.find((n) => n.resourceId === resourceId);

describe('BaseNode cross-project move (e2e)', () => {
  let app: INestApplication;
  let sourceBaseId: string;
  let targetBaseId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    const spaceId = globalThis.testConfig.spaceId;
    sourceBaseId = (await createBase({ name: 'move-node source', spaceId })).data.id;
    targetBaseId = (await createBase({ name: 'move-node target', spaceId })).data.id;
  });

  afterAll(async () => {
    await permanentDeleteBase(sourceBaseId);
    await permanentDeleteBase(targetBaseId);
    await app.close();
  });

  const createTableNode = async (baseId: string, name: string) => {
    const res = await createBaseNode(baseId, {
      resourceType: BaseNodeResourceType.Table,
      name,
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      views: [{ name: 'Grid view', type: ViewType.Grid }],
    });
    return res.data;
  };

  describe('table', () => {
    let companyNode: IBaseNodeVo;
    let personNode: IBaseNodeVo;
    let linkFieldId: string;
    let companyRecordId: string;

    beforeAll(async () => {
      companyNode = await createTableNode(sourceBaseId, 'Company');
      const companyFields = await getFields(companyNode.resourceId);
      const companyNameField = companyFields.find((f) => f.name === 'Name')!;

      const personRes = await createBaseNode(sourceBaseId, {
        resourceType: BaseNodeResourceType.Table,
        name: 'Person',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Company',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: companyNode.resourceId,
              lookupFieldId: companyNameField.id,
            },
          },
        ],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
      });
      personNode = personRes.data;
      const personFields = await getFields(personNode.resourceId);
      linkFieldId = personFields.find((f) => f.type === FieldType.Link)!.id;

      const company = await createRecords(companyNode.resourceId, {
        records: [{ fields: { [companyNameField.id]: 'Teable' } }],
      });
      companyRecordId = company.records[0].id;
      await createRecords(personNode.resourceId, {
        records: [
          {
            fields: {
              [personFields.find((f) => f.name === 'Name')!.id]: 'Alice',
              [linkFieldId]: { id: companyRecordId },
            },
          },
        ],
      });
    });

    it('previews the move: allowed, links crossing projects listed', async () => {
      const before = await getRecords(personNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(before.records[0].fields[linkFieldId]).toMatchObject({ id: companyRecordId });

      const { data } = await moveBaseNodeCheck(sourceBaseId, personNode.id, { targetBaseId });
      expect(data.allowed).toBe(true);
      expect(data.blockers).toEqual([]);
      expect(data.nodes.map((n) => n.resourceId)).toEqual([personNode.resourceId]);

      const outgoing = data.crossBaseLinks.find((l) => l.direction === 'outgoing');
      expect(outgoing).toMatchObject({
        tableId: personNode.resourceId,
        fieldId: linkFieldId,
        foreignTableId: companyNode.resourceId,
      });
      const incoming = data.crossBaseLinks.find((l) => l.direction === 'incoming');
      expect(incoming).toMatchObject({
        tableId: companyNode.resourceId,
        foreignTableId: personNode.resourceId,
      });
    });

    it('rejects a move into the same project', async () => {
      const { data } = await moveBaseNodeCheck(sourceBaseId, personNode.id, {
        targetBaseId: sourceBaseId,
      });
      expect(data.allowed).toBe(false);
      expect(data.blockers[0].code).toBe(MoveBaseNodeBlockerCode.SameBase);
    });

    it('moves the table with its data and turns the link into a cross-project link', async () => {
      const { data: moved } = await moveBaseNode(sourceBaseId, personNode.id, { targetBaseId });
      expect(moved.id).toBe(personNode.id);
      expect(moved.resourceId).toBe(personNode.resourceId);
      expect(moved.parentId).toBeNull();

      const sourceNodes = (await getBaseNodeList(sourceBaseId)).data;
      expect(nodeOf(sourceNodes, personNode.resourceId)).toBeUndefined();
      const targetNodes = (await getBaseNodeList(targetBaseId)).data;
      expect(nodeOf(targetNodes, personNode.resourceId)).toBeDefined();

      const table = await getTable(targetBaseId, personNode.resourceId);
      expect(table.dbTableName.startsWith(`${targetBaseId}.`)).toBe(true);

      const records = await getRecords(personNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(records.records).toHaveLength(1);
      expect(records.records[0].fields[linkFieldId]).toMatchObject({ id: companyRecordId });

      const personFields = await getFields(personNode.resourceId);
      const link = personFields.find((f) => f.id === linkFieldId)!;
      expect((link.options as ILinkFieldOptions).baseId).toBe(sourceBaseId);

      const companyFields = await getFields(companyNode.resourceId);
      const symmetric = companyFields.find((f) => f.type === FieldType.Link)!;
      expect((symmetric.options as ILinkFieldOptions).baseId).toBe(targetBaseId);
      expect((symmetric.options as ILinkFieldOptions).fkHostTableName).toBe(table.dbTableName);
    });

    it('moving the other end back together removes the cross-project marker', async () => {
      const { data: moved } = await moveBaseNode(sourceBaseId, companyNode.id, { targetBaseId });
      expect(moved.resourceId).toBe(companyNode.resourceId);

      const personFields = await getFields(personNode.resourceId);
      const link = personFields.find((f) => f.id === linkFieldId)!;
      expect((link.options as ILinkFieldOptions).baseId).toBeUndefined();
      const companyFields = await getFields(companyNode.resourceId);
      const symmetric = companyFields.find((f) => f.type === FieldType.Link)!;
      expect((symmetric.options as ILinkFieldOptions).baseId).toBeUndefined();

      const records = await getRecords(personNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(records.records[0].fields[linkFieldId]).toMatchObject({ id: companyRecordId });
    });
  });

  describe('a link field in the trash whose foreign table moves', () => {
    it('comes back naming the project the table moved to', async () => {
      const shelf = await createTableNode(sourceBaseId, 'Trash shelf');
      const shelfNameField = (await getFields(shelf.resourceId)).find((f) => f.name === 'Name')!;
      const rack = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Rack',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Shelf',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyOne,
                foreignTableId: shelf.resourceId,
                lookupFieldId: shelfNameField.id,
              },
            },
          ],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;
      const link = (await getFields(rack.resourceId)).find((f) => f.type === FieldType.Link)!;

      // a field deleted on its own is kept as a snapshot in the table's trash
      await deleteField(rack.resourceId, link.id);
      await moveBaseNode(sourceBaseId, shelf.id, { targetBaseId });

      const items = (
        await getTrashItems({ resourceType: TrashType.Table, resourceId: rack.resourceId })
      ).data.trashItems;
      const item = items.find((t) => 'resourceIds' in t && t.resourceIds.includes(link.id))!;
      await restoreTrash(item.id, rack.resourceId);

      const restored = (await getFields(rack.resourceId)).find((f) => f.type === FieldType.Link)!;
      expect((restored.options as ILinkFieldOptions).foreignTableId).toBe(shelf.resourceId);
      expect((restored.options as ILinkFieldOptions).baseId).toBe(targetBaseId);
    });
  });

  describe('a plugin view on the moved table', () => {
    it('keeps its install in the project the table moved to', async () => {
      const prisma = app.get(PrismaService);
      const table = await createTableNode(sourceBaseId, 'Sheet');
      const view = (
        await installViewPlugin(table.resourceId, { name: 'sheet', pluginId: 'plgsheetform' })
      ).data;

      await moveBaseNode(sourceBaseId, table.id, { targetBaseId });

      const install = await prisma.pluginInstall.findUniqueOrThrow({
        where: { id: view.pluginInstallId },
        select: { baseId: true, plugin: { select: { pluginUser: true } } },
      });
      expect(install.baseId).toBe(targetBaseId);
      // a plugin that acts through its own account must be let into the new
      // project; the official sheet-form plugin has none, so this is skipped there
      if (install.plugin.pluginUser) {
        const collaborator = await prisma.collaborator.findFirst({
          where: { resourceId: targetBaseId, principalId: install.plugin.pluginUser },
          select: { id: true },
        });
        expect(collaborator).not.toBeNull();
      }
    });
  });

  describe('a table in the trash that links to the moved one', () => {
    it('comes back naming the project the table moved to', async () => {
      const shelf = await createTableNode(sourceBaseId, 'Shelf');
      const shelfNameField = (await getFields(shelf.resourceId)).find((f) => f.name === 'Name')!;
      const library = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Library',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Shelves',
              type: FieldType.Link,
              options: {
                // the foreign key sits on the many side: the table that moves
                relationship: Relationship.OneMany,
                foreignTableId: shelf.resourceId,
                lookupFieldId: shelfNameField.id,
              },
            },
          ],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;
      const linkBefore = (await getFields(library.resourceId)).find(
        (f) => f.type === FieldType.Link
      )!;
      expect(
        (linkBefore.options as ILinkFieldOptions).fkHostTableName.startsWith(sourceBaseId)
      ).toBe(true);

      await deleteTable(sourceBaseId, library.resourceId);
      await moveBaseNode(sourceBaseId, shelf.id, { targetBaseId });

      const trash = (
        await getTrashItems({ resourceType: TrashType.Base, resourceId: sourceBaseId })
      ).data.trashItems;
      const item = trash.find((t) => 'resourceId' in t && t.resourceId === library.resourceId)!;
      await restoreTrash(item.id);

      // the stored options were rewritten while the table was in the trash
      const link = (await getFields(library.resourceId)).find((f) => f.type === FieldType.Link)!;
      const options = link.options as ILinkFieldOptions;
      expect(options.baseId).toBe(targetBaseId);
      expect(options.fkHostTableName).toBe(
        (await getTable(targetBaseId, shelf.resourceId)).dbTableName
      );
    });
  });

  describe('bringing connected items along', () => {
    it('offers the linked table as a candidate and moves both together', async () => {
      const parts = await createTableNode(sourceBaseId, 'Parts');
      const partsNameField = (await getFields(parts.resourceId)).find((f) => f.name === 'Name')!;
      const orders = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Orders',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Part',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyOne,
                foreignTableId: parts.resourceId,
                lookupFieldId: partsNameField.id,
              },
            },
          ],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;

      const { data: before } = await moveBaseNodeCheck(sourceBaseId, orders.id, { targetBaseId });
      const candidate = before.candidates.find((c) => c.resourceId === parts.resourceId);
      expect(candidate).toMatchObject({ nodeId: parts.id, reason: 'link' });
      expect(candidate?.relatedNames).toContain('Orders');

      // picking it up makes the warning disappear before the move happens
      const { data: after } = await moveBaseNodeCheck(sourceBaseId, orders.id, {
        targetBaseId,
        additionalNodeIds: [parts.id],
      });
      expect(after.allowed).toBe(true);
      expect(after.crossBaseLinks).toEqual([]);
      expect(after.candidates).toEqual([]);
      expect(after.nodes.map((n) => n.resourceId).sort()).toEqual(
        [orders.resourceId, parts.resourceId].sort()
      );

      await moveBaseNode(sourceBaseId, orders.id, {
        targetBaseId,
        additionalNodeIds: [parts.id],
      });

      const sourceNodes = (await getBaseNodeList(sourceBaseId)).data;
      expect(nodeOf(sourceNodes, orders.resourceId)).toBeUndefined();
      expect(nodeOf(sourceNodes, parts.resourceId)).toBeUndefined();
      const targetNodes = (await getBaseNodeList(targetBaseId)).data;
      expect(nodeOf(targetNodes, orders.resourceId)?.parentId).toBeNull();
      expect(nodeOf(targetNodes, parts.resourceId)?.parentId).toBeNull();

      // both ends landed together, so the link is a plain same-project link again
      const link = (await getFields(orders.resourceId)).find((f) => f.type === FieldType.Link)!;
      expect((link.options as ILinkFieldOptions).baseId).toBeUndefined();
      const partsTable = await getTable(targetBaseId, parts.resourceId);
      expect((link.options as ILinkFieldOptions).fkHostTableName).toContain(targetBaseId);
      expect(partsTable.dbTableName.startsWith(`${targetBaseId}.`)).toBe(true);
    });
  });

  describe('many-to-many: the junction table travels too', () => {
    let authorNode: IBaseNodeVo;
    let bookNode: IBaseNodeVo;
    let bookLinkFieldId: string;
    let authorRecordId: string;

    beforeAll(async () => {
      authorNode = await createTableNode(sourceBaseId, 'Author');
      const authorName = (await getFields(authorNode.resourceId)).find((f) => f.name === 'Name')!;
      bookNode = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Book',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Authors',
              type: FieldType.Link,
              options: {
                // the many-many case is the one that gets its own physical
                // relation, and it is the one nothing else here exercises
                relationship: Relationship.ManyMany,
                foreignTableId: authorNode.resourceId,
                lookupFieldId: authorName.id,
              },
            },
          ],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;
      const bookFields = await getFields(bookNode.resourceId);
      bookLinkFieldId = bookFields.find((f) => f.type === FieldType.Link)!.id;

      const author = await createRecords(authorNode.resourceId, {
        records: [{ fields: { [authorName.id]: 'Ursula' } }],
      });
      authorRecordId = author.records[0].id;
      await createRecords(bookNode.resourceId, {
        records: [
          {
            fields: {
              [bookFields.find((f) => f.name === 'Name')!.id]: 'A Wizard of Earthsea',
              [bookLinkFieldId]: [{ id: authorRecordId }],
            },
          },
        ],
      });
    });

    it('keeps both ends readable and writable when the pair moves together', async () => {
      const { data: check } = await moveBaseNodeCheck(sourceBaseId, bookNode.id, { targetBaseId });
      const partner = check.candidates.find((c) => c.resourceId === authorNode.resourceId);
      expect(partner).toMatchObject({ reason: 'link' });

      await moveBaseNode(sourceBaseId, bookNode.id, {
        targetBaseId,
        additionalNodeIds: [authorNode.id],
      });

      // the link value survives, which it cannot unless the junction relation
      // moved with the tables and its fk host was rewritten to match
      const books = await getRecords(bookNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(books.records[0].fields[bookLinkFieldId]).toEqual([
        expect.objectContaining({ id: authorRecordId }),
      ]);

      // and it still accepts writes in its new home
      const second = await createRecords(authorNode.resourceId, {
        records: [{ fields: {} }],
      });
      await updateRecord(bookNode.resourceId, books.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [bookLinkFieldId]: [{ id: authorRecordId }, { id: second.records[0].id }],
          },
        },
      });
      const after = await getRecords(bookNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(after.records[0].fields[bookLinkFieldId]).toHaveLength(2);

      // both ends travelled, so nothing about this link is cross-project
      const linkField = (await getFields(bookNode.resourceId)).find(
        (f) => f.id === bookLinkFieldId
      )!;
      expect((linkField.options as { baseId?: string }).baseId).toBeUndefined();
    });
  });

  describe('a lookup field over the link', () => {
    let sourceTableNode: IBaseNodeVo;
    let holderNode: IBaseNodeVo;
    let lookupFieldId: string;

    beforeAll(async () => {
      sourceTableNode = await createTableNode(sourceBaseId, 'Supplier');
      const supplierName = (await getFields(sourceTableNode.resourceId)).find(
        (f) => f.name === 'Name'
      )!;
      holderNode = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Part',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Supplier',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyOne,
                foreignTableId: sourceTableNode.resourceId,
                lookupFieldId: supplierName.id,
              },
            },
          ],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;
      const holderLink = (await getFields(holderNode.resourceId)).find(
        (f) => f.type === FieldType.Link
      )!;
      // a lookup keeps its own copy of the foreign table and fk host, so it is
      // a second rewrite path that the plain link tests never touch
      const lookup = await createField(holderNode.resourceId, {
        name: 'Supplier name',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: sourceTableNode.resourceId,
          linkFieldId: holderLink.id,
          lookupFieldId: supplierName.id,
        },
      });
      lookupFieldId = lookup.id;

      const supplier = await createRecords(sourceTableNode.resourceId, {
        records: [{ fields: { [supplierName.id]: 'Acme' } }],
      });
      await createRecords(holderNode.resourceId, {
        records: [
          {
            fields: {
              [(await getFields(holderNode.resourceId)).find((f) => f.name === 'Name')!.id]: 'Bolt',
              [holderLink.id]: { id: supplier.records[0].id },
            },
          },
        ],
      });
    });

    it('still resolves after only the holder moves', async () => {
      await moveBaseNode(sourceBaseId, holderNode.id, { targetBaseId });

      // the value still resolves, which it cannot unless the lookup's own copy
      // of the foreign table and its fk host survived the move
      const records = await getRecords(holderNode.resourceId, { fieldKeyType: FieldKeyType.Id });
      expect(records.records[0].fields[lookupFieldId]).toBe('Acme');

      // and the link it reads through is marked as reaching the other project
      const link = (await getFields(holderNode.resourceId)).find((f) => f.type === FieldType.Link)!;
      expect((link.options as { baseId?: string }).baseId).toBe(sourceBaseId);
    });
  });

  describe('a third project referencing the moved table', () => {
    it('re-points its link marker to the new project', async () => {
      const thirdBaseId = (
        await createBase({ name: 'move-node third', spaceId: globalThis.testConfig.spaceId })
      ).data.id;
      try {
        const target = await createTableNode(sourceBaseId, 'Referenced');
        const targetNameField = (await getFields(target.resourceId)).find(
          (f) => f.name === 'Name'
        )!;
        const referrer = (
          await createBaseNode(thirdBaseId, {
            resourceType: BaseNodeResourceType.Table,
            name: 'Referrer',
            fields: [
              { name: 'Name', type: FieldType.SingleLineText },
              {
                name: 'Ref',
                type: FieldType.Link,
                options: {
                  relationship: Relationship.ManyOne,
                  foreignTableId: target.resourceId,
                  lookupFieldId: targetNameField.id,
                  baseId: sourceBaseId,
                },
              },
            ],
            views: [{ name: 'Grid view', type: ViewType.Grid }],
          })
        ).data;
        const before = (await getFields(referrer.resourceId)).find(
          (f) => f.type === FieldType.Link
        )!;
        expect((before.options as ILinkFieldOptions).baseId).toBe(sourceBaseId);

        await moveBaseNode(sourceBaseId, target.id, { targetBaseId });

        const after = (await getFields(referrer.resourceId)).find(
          (f) => f.type === FieldType.Link
        )!;
        expect((after.options as ILinkFieldOptions).baseId).toBe(targetBaseId);
        const symmetric = (await getFields(target.resourceId)).find(
          (f) => f.type === FieldType.Link
        )!;
        expect((symmetric.options as ILinkFieldOptions).baseId).toBe(thirdBaseId);
      } finally {
        await permanentDeleteBase(thirdBaseId);
      }
    });
  });

  describe('folder subtree and placement', () => {
    it('moves a folder with everything inside it under a folder of the target', async () => {
      const folder = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Moving folder',
        })
      ).data;
      const inner = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Table,
          name: 'Inner table',
          parentId: folder.id,
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          views: [{ name: 'Grid view', type: ViewType.Grid }],
        })
      ).data;
      const dashboard = (
        await createBaseNode(sourceBaseId, {
          resourceType: BaseNodeResourceType.Dashboard,
          name: 'Inner dashboard',
          parentId: folder.id,
        })
      ).data;
      const targetFolder = (
        await createBaseNode(targetBaseId, {
          resourceType: BaseNodeResourceType.Folder,
          name: 'Target folder',
        })
      ).data;

      const { data: check } = await moveBaseNodeCheck(sourceBaseId, folder.id, { targetBaseId });
      expect(check.allowed).toBe(true);
      expect(check.nodes.map((n) => n.nodeId).sort()).toEqual(
        [folder.id, inner.id, dashboard.id].sort()
      );

      const { data: moved } = await moveBaseNode(sourceBaseId, folder.id, {
        targetBaseId,
        parentId: targetFolder.id,
      });
      expect(moved.parentId).toBe(targetFolder.id);

      const targetNodes = (await getBaseNodeList(targetBaseId)).data;
      expect(nodeOf(targetNodes, inner.resourceId)?.parentId).toBe(folder.id);
      expect(nodeOf(targetNodes, dashboard.resourceId)?.parentId).toBe(folder.id);
      const sourceNodes = (await getBaseNodeList(sourceBaseId)).data;
      expect(nodeOf(sourceNodes, folder.resourceId)).toBeUndefined();
      expect(nodeOf(sourceNodes, inner.resourceId)).toBeUndefined();
    });

    it('blocks a folder whose name already exists in the target', async () => {
      const name = 'Same name folder';
      const source = (
        await createBaseNode(sourceBaseId, { resourceType: BaseNodeResourceType.Folder, name })
      ).data;
      await createBaseNode(targetBaseId, { resourceType: BaseNodeResourceType.Folder, name });

      const { data: check } = await moveBaseNodeCheck(sourceBaseId, source.id, { targetBaseId });
      expect(check.allowed).toBe(false);
      expect(check.blockers.map((b) => b.code)).toContain(
        MoveBaseNodeBlockerCode.FolderNameConflict
      );

      const error = await getError(() => moveBaseNode(sourceBaseId, source.id, { targetBaseId }));
      expect(error?.status).toBe(400);
    });
  });

  describe('space boundary', () => {
    let otherSpaceId: string;
    let otherBaseId: string;

    beforeAll(async () => {
      otherSpaceId = (await apiCreateSpace({ name: 'move-node other space' })).data.id;
      otherBaseId = (await createBase({ name: 'other space base', spaceId: otherSpaceId })).data.id;
    });

    afterAll(async () => {
      await permanentDeleteBase(otherBaseId);
      await apiPermanentDeleteSpace(otherSpaceId);
    });

    it('refuses to move across spaces', async () => {
      const node = await createTableNode(sourceBaseId, 'Stays home');
      const { data: check } = await moveBaseNodeCheck(sourceBaseId, node.id, {
        targetBaseId: otherBaseId,
      });
      expect(check.allowed).toBe(false);
      expect(check.blockers.map((b) => b.code)).toContain(MoveBaseNodeBlockerCode.DifferentSpace);

      const error = await getError(() =>
        moveBaseNode(sourceBaseId, node.id, { targetBaseId: otherBaseId })
      );
      expect(error?.status).toBe(400);
      expect(nodeOf((await getBaseNodeList(sourceBaseId)).data, node.resourceId)).toBeDefined();
    });
  });
});
