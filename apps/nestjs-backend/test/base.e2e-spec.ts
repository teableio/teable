import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType, Relationship, Role } from '@teable/core';
import type {
  ICreateBaseVo,
  ICreateSpaceVo,
  IUserMeVo,
  ListBaseInvitationLinkVo,
  UserCollaboratorItem,
  IBaseErdEdge,
} from '@teable/openapi';
import {
  baseErdVoSchema,
  CREATE_BASE,
  CREATE_BASE_INVITATION_LINK,
  CREATE_SPACE,
  createBaseInvitationLink,
  createBaseInvitationLinkVoSchema,
  createTable,
  DELETE_BASE,
  DELETE_BASE_COLLABORATOR,
  DELETE_SPACE,
  deleteBaseCollaborator,
  deleteBaseInvitationLink,
  EMAIL_BASE_INVITATION,
  emailBaseInvitation,
  GET_BASE_LIST,
  getBaseAll,
  getBaseCollaboratorList,
  getBaseErd,
  getUserCollaborators,
  listBaseCollaboratorUserVoSchema,
  listBaseInvitationLink,
  MOVE_BASE,
  PrincipalType,
  UPDATE_BASE_COLLABORATE,
  UPDATE_BASE_INVITATION_LINK,
  updateBaseCollaborator,
  updateBaseInvitationLink,
  urlBuilder,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createSpace,
  deleteSpace,
  initApp,
  permanentDeleteSpace,
} from './utils/init-app';

describe('OpenAPI BaseController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Base Invitation and operator collaborators', () => {
    const newUserEmail = 'newuser@example.com';
    const newUser3Email = 'newuser2@example.com';

    let userRequest: AxiosInstance;
    let user3Request: AxiosInstance;
    let spaceId: string;
    let baseId: string;
    beforeAll(async () => {
      user3Request = await createNewUserAxios({
        email: newUser3Email,
        password: '12345678',
      });
      userRequest = await createNewUserAxios({
        email: newUserEmail,
        password: '12345678',
      });
      spaceId = (await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, { name: 'new base' })).data
        .id;
    });
    beforeEach(async () => {
      const res = await userRequest.post<ICreateBaseVo>(CREATE_BASE, {
        name: 'new base',
        spaceId,
      });
      baseId = res.data.id;
      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [globalThis.testConfig.email],
        role: Role.Creator,
      });
    });

    afterEach(async () => {
      await userRequest.delete<null>(
        urlBuilder(DELETE_BASE, {
          baseId,
        })
      );
    });
    afterAll(async () => {
      await userRequest.delete<null>(
        urlBuilder(DELETE_SPACE, {
          spaceId,
        })
      );
    });

    it('/api/base/:baseId/invitation/link (POST)', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Creator },
      });
      expect(createBaseInvitationLinkVoSchema.safeParse(res.data).success).toEqual(true);

      const linkList = await listBaseInvitationLink(baseId);
      expect(linkList.data).toHaveLength(1);
    });

    it('/api/base/{baseId}/invitation/link (POST) - Forbidden', async () => {
      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [newUser3Email],
        role: Role.Editor,
      });
      const error = await getError(() =>
        user3Request.post(urlBuilder(CREATE_BASE_INVITATION_LINK, { baseId }), {
          role: Role.Creator,
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/base/:baseId/invitation/link/:invitationId (PATCH)', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      const newBaseUpdate = await updateBaseInvitationLink({
        baseId,
        invitationId: newInvitationId,
        updateBaseInvitationLinkRo: { role: Role.Editor },
      });
      expect(newBaseUpdate.data.role).toEqual(Role.Editor);
    });

    it('/api/base/:baseId/invitation/link/:invitationId (PATCH) - exceeds limit role', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [newUser3Email],
        role: Role.Editor,
      });
      const error = await getError(() =>
        user3Request.patch(
          urlBuilder(UPDATE_BASE_INVITATION_LINK, { baseId, invitationId: newInvitationId }),
          { role: Role.Creator }
        )
      );
      expect(error?.status).toBe(403);
    });

    it('/api/base/:baseId/invitation/link (GET)', async () => {
      const res = await getBaseCollaboratorList(baseId);
      expect(res.data.collaborators).toHaveLength(2);
    });

    it('/api/base/:baseId/invitation/link (GET) - pagination', async () => {
      const res = await getBaseCollaboratorList(baseId, { skip: 1, take: 1 });
      expect(res.data.collaborators).toHaveLength(1);
      expect(res.data.total).toBe(2);
    });

    it('/api/base/:baseId/invitation/link (GET) - search', async () => {
      const res = await getBaseCollaboratorList(baseId, { search: 'newuser' });
      expect(res.data.collaborators).toHaveLength(1);
      expect((res.data.collaborators[0] as UserCollaboratorItem).email).toBe(newUserEmail);
      expect(res.data.total).toBe(1);
    });

    it('/api/base/:baseId/invitation/link/:invitationId (DELETE)', async () => {
      const res = await createBaseInvitationLink({
        baseId,
        createBaseInvitationLinkRo: { role: Role.Editor },
      });
      const newInvitationId = res.data.invitationId;

      await deleteBaseInvitationLink({ baseId, invitationId: newInvitationId });

      const list: ListBaseInvitationLinkVo = (await listBaseInvitationLink(baseId)).data;
      expect(list.find((v) => v.invitationId === newInvitationId)).toBeUndefined();
    });

    it('/api/base/:baseId/invitation/email (POST)', async () => {
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { role: Role.Creator, emails: [newUser3Email] },
      });

      const { collaborators } = (await getBaseCollaboratorList(baseId)).data;

      const newCollaboratorInfo = (collaborators as UserCollaboratorItem[]).find(
        ({ email }) => email === newUser3Email
      );

      expect(newCollaboratorInfo).not.toBeUndefined();
      expect(newCollaboratorInfo?.role).toEqual(Role.Creator);
    });

    it('/api/base/:baseId/invitation/email (POST) - exceeds limit role', async () => {
      await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
        emails: [newUser3Email],
        role: Role.Editor,
      });
      const error = await getError(() =>
        user3Request.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
          emails: [newUser3Email],
          role: Role.Creator,
        })
      );
      expect(error?.status).toBe(403);
    });

    it('/api/base/:baseId/invitation/email (POST) - not exist email', async () => {
      await emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: ['not.exist@email.com'], role: Role.Creator },
      });
      const { collaborators } = (await getBaseCollaboratorList(baseId)).data;
      expect(collaborators).toHaveLength(3);
    });

    it('/api/base/:baseId/invitation/email (POST) - user in space', async () => {
      const error = await getError(() =>
        emailBaseInvitation({
          baseId,
          emailBaseInvitationRo: { emails: [globalThis.testConfig.email], role: Role.Creator },
        })
      );
      expect(error?.status).toBe(400);
    });

    describe('operator collaborators', () => {
      let newUser3Id: string;
      beforeEach(async () => {
        await userRequest.post(urlBuilder(EMAIL_BASE_INVITATION, { baseId }), {
          emails: [newUser3Email],
          role: Role.Editor,
        });
        const res = await user3Request.get<IUserMeVo>(USER_ME);
        newUser3Id = res.data.id;
      });

      it('/api/base/:baseId/collaborator/users (GET)', async () => {
        const res = await getUserCollaborators(baseId);
        expect(res.data.users).toHaveLength(3);
        expect(res.data.total).toBe(3);
        expect(listBaseCollaboratorUserVoSchema.strict().safeParse(res.data).success).toEqual(true);
      });

      it('/api/base/:baseId/collaborator/users (GET) - pagination', async () => {
        const res = await getUserCollaborators(baseId, { skip: 1, take: 1 });
        expect(res.data.users).toHaveLength(1);
        expect(res.data.total).toBe(3);
      });

      it('/api/base/:baseId/collaborator/users (GET) - search', async () => {
        const res = await getUserCollaborators(baseId, { search: 'newuser' });
        expect(res.data.users).toHaveLength(2);
        expect(res.data.total).toBe(2);
      });

      it('/api/base/:baseId/collaborators (PATCH)', async () => {
        const res = await updateBaseCollaborator({
          baseId,
          updateBaseCollaborateRo: {
            role: Role.Creator,
            principalId: newUser3Id,
            principalType: PrincipalType.User,
          },
        });
        expect(res.status).toBe(200);
      });

      it('/api/base/:baseId/collaborators (PATCH) - exceeds limit role', async () => {
        const error = await getError(() =>
          user3Request.patch<void>(
            urlBuilder(UPDATE_BASE_COLLABORATE, {
              baseId,
            }),
            {
              role: Role.Viewer,
              principalId: globalThis.testConfig.userId,
              principalType: PrincipalType.User,
            }
          )
        );
        expect(error?.status).toBe(403);
      });

      it('/api/base/:baseId/collaborators (PATCH) - exceeds limit role - system user', async () => {
        await updateBaseCollaborator({
          baseId: baseId,
          updateBaseCollaborateRo: {
            role: Role.Editor,
            principalId: globalThis.testConfig.userId,
            principalType: PrincipalType.User,
          },
        });
        const error = await getError(() =>
          updateBaseCollaborator({
            baseId: baseId,
            updateBaseCollaborateRo: {
              role: Role.Creator,
              principalId: globalThis.testConfig.userId,
              principalType: PrincipalType.User,
            },
          })
        );
        expect(error?.status).toBe(403);
      });

      it('/api/base/:baseId/collaborators (PATCH) - self ', async () => {
        const res = await updateBaseCollaborator({
          baseId: baseId,
          updateBaseCollaborateRo: {
            role: Role.Editor,
            principalId: globalThis.testConfig.userId,
            principalType: PrincipalType.User,
          },
        });
        expect(res?.status).toBe(200);
      });

      it('/api/base/:baseId/collaborators (PATCH) - allow update role equal to self', async () => {
        await updateBaseCollaborator({
          baseId: baseId,
          updateBaseCollaborateRo: {
            role: Role.Editor,
            principalId: globalThis.testConfig.userId,
            principalType: PrincipalType.User,
          },
        });
        const res = await user3Request.patch<void>(
          urlBuilder(UPDATE_BASE_COLLABORATE, {
            baseId,
          }),
          {
            role: Role.Viewer,
            principalId: newUser3Id,
            principalType: PrincipalType.User,
          }
        );
        expect(res?.status).toBe(200);
      });

      it('/api/base/:baseId/collaborators (DELETE)', async () => {
        const res = await deleteBaseCollaborator({
          baseId,
          deleteBaseCollaboratorRo: {
            principalId: newUser3Id,
            principalType: PrincipalType.User,
          },
        });
        expect(res.status).toBe(200);
        const collList = await getBaseCollaboratorList(baseId);
        expect(collList.data.collaborators).toHaveLength(2);
      });

      it('/api/base/:baseId/collaborators (DELETE) - exceeds limit role', async () => {
        await updateBaseCollaborator({
          baseId,
          updateBaseCollaborateRo: {
            role: Role.Creator,
            principalId: newUser3Id,
            principalType: PrincipalType.User,
          },
        });
        const error = await getError(() =>
          deleteBaseCollaborator({
            baseId,
            deleteBaseCollaboratorRo: {
              principalId: newUser3Id,
              principalType: PrincipalType.User,
            },
          })
        );
        expect(error?.status).toBe(403);
      });

      it('/api/base/:baseId/collaborators (DELETE) - self', async () => {
        await deleteBaseCollaborator({
          baseId: baseId,
          deleteBaseCollaboratorRo: {
            principalId: globalThis.testConfig.userId,
            principalType: PrincipalType.User,
          },
        });
        const error = await getError(() => getBaseCollaboratorList(baseId));
        expect(error?.status).toBe(403);
      });

      it('/api/base/:baseId/collaborators (DELETE) - space user delete base user', async () => {
        const res = await userRequest.delete(urlBuilder(DELETE_BASE_COLLABORATOR, { baseId }), {
          params: { principalId: newUser3Id, principalType: PrincipalType.User },
        });
        expect(res.status).toBe(200);
      });

      it('/api/space/:spaceId/collaborators (DELETE) - space user delete base user', async () => {
        const res = await userRequest.delete(urlBuilder(DELETE_BASE_COLLABORATOR, { baseId }), {
          params: { principalId: newUser3Id, principalType: PrincipalType.User },
        });
        expect(res.status).toBe(200);
      });

      it('/api/base/:baseId/move (PUT)', async () => {
        const user1SpaceId = (
          await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, { name: 'new base' })
        ).data.id;

        const user1SpaceId2 = (
          await userRequest.post<ICreateSpaceVo>(CREATE_SPACE, { name: 'new base2' })
        ).data.id;

        const spaceBaseList1 = (
          await userRequest.get(urlBuilder(GET_BASE_LIST, { spaceId: user1SpaceId }))
        ).data;

        const spaceBaseList2 = (
          await userRequest.get(urlBuilder(GET_BASE_LIST, { spaceId: user1SpaceId2 }))
        ).data;

        expect(spaceBaseList1.length).toBe(0);
        expect(spaceBaseList2.length).toBe(0);

        const newBase1 = (
          await userRequest.post(urlBuilder(CREATE_BASE), {
            name: 'base1',
            spaceId: user1SpaceId,
          })
        ).data;

        // move base
        await userRequest.put(
          urlBuilder(MOVE_BASE, {
            baseId: newBase1.id,
          }),
          {
            spaceId: user1SpaceId2,
          }
        );

        const spaceBaseList1AfterMove = (
          await userRequest.get(urlBuilder(GET_BASE_LIST, { spaceId: user1SpaceId2 }))
        ).data;

        expect(spaceBaseList1AfterMove.length).toBe(1);
        expect(spaceBaseList1AfterMove[0].id).toBe(newBase1.id);
      });
    });
  });

  it('/api/base/access/all (GET)', async () => {
    const spaceId1 = await createSpace({
      name: 'new space test base access all',
    }).then((res) => res.id);
    const baseId1 = await createBase({
      name: 'new base test base access all',
      spaceId: spaceId1,
    }).then((res) => res.id);
    const spaceId2 = await createSpace({
      name: 'new space test base access all',
    }).then((res) => res.id);
    const baseId2 = await createBase({
      name: 'new base test base access all',
      spaceId: spaceId2,
    }).then((res) => res.id);

    await deleteSpace(spaceId1);

    const res = await getBaseAll();

    await permanentDeleteSpace(spaceId1);
    await permanentDeleteSpace(spaceId2);

    expect(res.data.find((v) => v.id === baseId1)).toBeUndefined();
    expect(res.data.find((v) => v.id === baseId2)).toBeDefined();
  });

  describe('Base ERD', () => {
    let spaceId1: string;

    beforeEach(async () => {
      spaceId1 = await createSpace({
        name: 'new space test base erd',
      }).then((res) => res.id);
    });
    afterEach(async () => {
      await permanentDeleteSpace(spaceId1);
    });

    const getRelationReference = (edges: IBaseErdEdge[]) => {
      return edges
        .filter((edge) => Boolean(edge.relationship))
        .map((edge) => {
          const { source, target } = edge;
          return `${source.tableId}.${source.fieldId}-${target.tableId}.${target.fieldId}`;
        })
        .sort();
    };

    const getTypeMap = (edges: IBaseErdEdge[]) => {
      return edges
        .filter((edge) => !edge.relationship)
        .reduce(
          (acc, edge) => {
            acc[edge.type] = (acc[edge.type] || 0) + 1;
            return acc;
          },
          {} as Record<FieldType | 'lookup', number>
        );
    };

    it('/api/base/:baseId/erd (GET) - relationship', async () => {
      const baseId = await createBase({
        spaceId: spaceId1,
      }).then((res) => res.id);
      const table1 = await createTable(baseId).then((res) => res.data);
      const table2 = await createTable(baseId).then((res) => res.data);

      await createField(table1.id, {
        name: 'new link field1',
        type: FieldType.Link,
        options: {
          isOneWay: true,
          foreignTableId: table2.id,
          relationship: Relationship.OneOne,
        },
      });

      await createField(table1.id, {
        name: 'new link field2',
        type: FieldType.Link,
        options: {
          isOneWay: true,
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      await createField(table1.id, {
        name: 'new link field3',
        type: FieldType.Link,
        options: {
          foreignTableId: table2.id,
          relationship: Relationship.ManyOne,
        },
      });

      await createField(table1.id, {
        name: 'new link field4',
        type: FieldType.Link,
        options: {
          foreignTableId: table2.id,
          relationship: Relationship.ManyMany,
        },
      });

      const data = await getBaseErd(baseId).then((res) => res.data);
      expect(baseErdVoSchema.safeParse(data).success).toEqual(true);
      expect(data.baseId).toEqual(baseId);
      expect(getRelationReference(data.edges).length).toEqual(4);
    });

    it('/api/base/:baseId/erd (GET) - reference(formula, lookup, rollup, link)', async () => {
      const baseId = await createBase({
        spaceId: spaceId1,
      }).then((res) => res.id);
      const table1 = await createTable(baseId).then((res) => res.data);
      const table2 = await createTable(baseId).then((res) => res.data);

      const textField = table1.fields[0];
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          foreignTableId: table2.id,
          relationship: Relationship.OneOne,
        },
      });

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      await createField(table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      await createField(table1.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${textField.id}}`,
        },
      });

      await createField(table1.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${lookupField.id}}`,
        },
      });

      const data = await getBaseErd(baseId).then((res) => res.data);
      expect(baseErdVoSchema.safeParse(data).success).toEqual(true);
      expect(data.baseId).toEqual(baseId);
      expect(getRelationReference(data.edges).length).toEqual(1);
      const typeMap = getTypeMap(data.edges);
      expect(typeMap).toEqual({
        formula: 2,
        link: (linkField.options as ILinkFieldOptions).isOneWay ? 1 : 2,
        lookup: 1,
        rollup: 1,
      });
    });

    it('/api/base/:baseId/erd (GET) - cross base', async () => {
      const baseId1 = await createBase({
        spaceId: spaceId1,
      }).then((res) => res.id);
      const base1Table1 = await createTable(baseId1).then((res) => res.data);

      const baseId2 = await createBase({
        spaceId: spaceId1,
      }).then((res) => res.id);
      const base2Table1 = await createTable(baseId2).then((res) => res.data);

      await createField(base1Table1.id, {
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          foreignTableId: base2Table1.id,
          relationship: Relationship.OneOne,
        },
      });

      const baseId3 = await createBase({
        spaceId: spaceId1,
      }).then((res) => res.id);
      const base3Table1 = await createTable(baseId3).then((res) => res.data);

      await createField(base2Table1.id, {
        type: FieldType.Link,
        options: {
          baseId: baseId3,
          foreignTableId: base3Table1.id,
          relationship: Relationship.OneOne,
        },
      });

      const base1Erd = await getBaseErd(baseId1).then((res) => res.data);
      expect(baseErdVoSchema.safeParse(base1Erd).success).toEqual(true);
      expect(base1Erd.baseId).toEqual(baseId1);
      expect(getRelationReference(base1Erd.edges).length).toEqual(1);

      const base2Erd = await getBaseErd(baseId2).then((res) => res.data);
      expect(baseErdVoSchema.safeParse(base2Erd).success).toEqual(true);
      expect(base2Erd.baseId).toEqual(baseId2);
      expect(getRelationReference(base2Erd.edges).length).toEqual(2);
    });
  });
});
