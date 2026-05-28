import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptions, ILinkFieldOptionsRo } from '@teable/core';
import { DriverClient, FieldKeyType, FieldType, Relationship, Role } from '@teable/core';
import type {
  ICreateBaseVo,
  ICreateSpaceVo,
  ITableFullVo,
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
  DELETE_SPACE_COLLABORATOR,
  deleteBaseCollaborator,
  deleteBaseInvitationLink,
  EMAIL_BASE_INVITATION,
  EMAIL_SPACE_INVITATION,
  emailBaseInvitation,
  GET_BASE_ALL,
  GET_BASE_LIST,
  getBaseAll,
  getBaseCollaboratorList,
  getBaseErd,
  getUserCollaborators,
  listBaseCollaboratorUserVoSchema,
  listBaseInvitationLink,
  MOVE_BASE,
  moveBase,
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
  createRecords,
  createSpace,
  deleteSpace,
  getFields,
  getRecords,
  initApp,
  permanentDeleteBase,
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

  describe('Base owner display after member removal', () => {
    const userAEmail = 'userA-t1606@example.com';
    const userBEmail = 'userB-t1606@example.com';
    let userARequest: AxiosInstance;
    let userBRequest: AxiosInstance;
    let userAId: string;
    let userBId: string;
    let spaceId: string;
    let baseId: string;

    beforeAll(async () => {
      // Create user A (space owner) and user B
      userARequest = await createNewUserAxios({
        email: userAEmail,
        password: '12345678',
      });
      userBRequest = await createNewUserAxios({
        email: userBEmail,
        password: '12345678',
      });

      // Get user A's ID (space owner)
      const userAInfo = await userARequest.get<IUserMeVo>(USER_ME);
      userAId = userAInfo.data.id;

      // Get user B's ID
      const userBInfo = await userBRequest.get<IUserMeVo>(USER_ME);
      userBId = userBInfo.data.id;

      // User A creates a space
      spaceId = (
        await userARequest.post<ICreateSpaceVo>(CREATE_SPACE, { name: 'T1606 test space' })
      ).data.id;

      // User A invites user B to the space
      await userARequest.post(urlBuilder(EMAIL_SPACE_INVITATION, { spaceId }), {
        emails: [userBEmail],
        role: Role.Creator,
      });

      // User B creates a base in the space
      baseId = (
        await userBRequest.post<ICreateBaseVo>(CREATE_BASE, {
          name: 'T1606 test base',
          spaceId,
        })
      ).data.id;
    });

    afterAll(async () => {
      // Clean up
      await userARequest.delete(urlBuilder(DELETE_BASE, { baseId }));
      await userARequest.delete(urlBuilder(DELETE_SPACE, { spaceId }));
    });

    it('should fallback to space owner when creator is removed from space', async () => {
      // Verify user B is the creator before removal (via getBaseAll)
      const beforeRemoval = await userARequest.get(GET_BASE_ALL);
      const baseBefore = beforeRemoval.data.find((b: { id: string }) => b.id === baseId);
      expect(baseBefore).toBeDefined();
      expect(baseBefore.createdUser).toBeDefined();
      expect(baseBefore.createdUser.id).toBe(userBId);

      // User A removes user B from the space
      await userARequest.delete(urlBuilder(DELETE_SPACE_COLLABORATOR, { spaceId }), {
        params: { principalId: userBId, principalType: PrincipalType.User },
      });

      // Verify createdUser is now the space owner (user A) after removal
      const afterRemoval = await userARequest.get(GET_BASE_ALL);
      const baseAfter = afterRemoval.data.find((b: { id: string }) => b.id === baseId);
      expect(baseAfter).toBeDefined();
      // The createdUser should fallback to space owner (user A) since user B is no longer in the space
      expect(baseAfter.createdUser).toBeDefined();
      expect(baseAfter.createdUser.id).toBe(userAId);
    });
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

  // Contract: moveBase preserves values on every affected field:
  //   - Dependent lookup/rollup convert via the regular convertField path in
  //     deepest-first order, so each one's stored value is snapshotted by
  //     cellValue2String before the upstream Link is downgraded.
  //   - The Link itself converts via convertCrossSpaceLinkToText, which skips
  //     the destructive linkToOther steps so the symmetric partner on the
  //     other base survives and gets converted independently in its turn,
  //     preserving its own display values.
  describe('moveBase cross-space value preservation', () => {
    let sourceSpaceId: string;
    let targetSpaceId: string;
    let movingBaseId: string;
    let peerBaseId: string;

    beforeAll(async () => {
      sourceSpaceId = (await createSpace({ name: 'move-src' })).id;
      targetSpaceId = (await createSpace({ name: 'move-dst' })).id;
    });

    afterAll(async () => {
      await permanentDeleteSpace(sourceSpaceId);
      await permanentDeleteSpace(targetSpaceId);
    });

    beforeEach(async () => {
      movingBaseId = (await createBase({ spaceId: sourceSpaceId, name: 'moving' })).id;
      peerBaseId = (await createBase({ spaceId: sourceSpaceId, name: 'peer' })).id;
    });

    afterEach(async () => {
      await permanentDeleteBase(movingBaseId);
      await permanentDeleteBase(peerBaseId);
    });

    it('preserves link, lookups, and the symmetric partner after move', async () => {
      // Cross-base links require Postgres data sharding per base; the same code
      // path is exercised — and the bug only surfaced — on PG.
      if (globalThis.testConfig.driver !== DriverClient.Pg) {
        return;
      }

      const peerTitle = 'peer-title-1';

      // Setup: peer base (target) gets a table with one record holding a known
      // title; moving base gets a cross-base link to that table plus a lookup
      // chain (link → lookupA → lookupB) so we exercise the multi-hop ordering.
      // Both tables are created with empty records so that the single record
      // we explicitly insert below is always at index 0 in getRecords.
      const peerTable = (await createTable(peerBaseId, { name: 'peer', records: [] })).data;
      const peerPrimary = peerTable.fields.find((f) => f.isPrimary)!;
      const peerRecord = (
        await createRecords(peerTable.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [peerPrimary.id]: peerTitle } }],
        })
      ).records[0];

      const movingTable = (await createTable(movingBaseId, { name: 'moving', records: [] })).data;
      const movingPrimary = movingTable.fields.find((f) => f.isPrimary)!;

      const linkField = await createField(movingTable.id, {
        name: 'cross_base_link',
        type: FieldType.Link,
        options: {
          baseId: peerBaseId,
          relationship: Relationship.ManyOne,
          foreignTableId: peerTable.id,
        },
      });
      // ManyOne auto-creates a OneMany symmetric on the peer table. After the
      // move it must survive (used to be cascade-deleted) and end up as text
      // with the linked moving record's primary value.
      const symmetricFieldId = (linkField.options as { symmetricFieldId?: string })
        .symmetricFieldId;
      expect(symmetricFieldId).toBeTruthy();

      const lookupA = await createField(movingTable.id, {
        name: 'lookup_a',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: peerTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: peerPrimary.id,
        },
      });

      const lookupB = await createField(movingTable.id, {
        name: 'lookup_b',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: peerTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: peerPrimary.id,
        },
      });

      await createRecords(movingTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [movingPrimary.id]: 'row-1',
              [linkField.id]: { id: peerRecord.id },
            },
          },
        ],
      });

      // Sanity: before the move, lookups must have the title materialised so
      // the post-move check is meaningful (otherwise null could mean "never
      // computed" rather than "wiped by cascade").
      const beforeRecords = await getRecords(movingTable.id, { fieldKeyType: FieldKeyType.Id });
      const beforeRow = beforeRecords.records[0];
      expect(beforeRow.fields[lookupA.id]).toBe(peerTitle);
      expect(beforeRow.fields[lookupB.id]).toBe(peerTitle);

      // Act: move the base — peer stays in sourceSpaceId, so the link becomes
      // cross-space and must be downgraded along with both lookups.
      const moveRes = await moveBase(movingBaseId, targetSpaceId);
      expect(moveRes.status).toBe(200);

      const fieldsAfter = await getFields(movingTable.id);
      const linkAfter = fieldsAfter.find((f) => f.id === linkField.id)!;
      const lookupAAfter = fieldsAfter.find((f) => f.id === lookupA.id)!;
      const lookupBAfter = fieldsAfter.find((f) => f.id === lookupB.id)!;

      expect(linkAfter.type).toBe(FieldType.SingleLineText);
      expect(lookupAAfter.type).toBe(FieldType.SingleLineText);
      expect(lookupAAfter.isLookup).toBeFalsy();
      expect(lookupBAfter.type).toBe(FieldType.SingleLineText);
      expect(lookupBAfter.isLookup).toBeFalsy();

      const afterRecords = await getRecords(movingTable.id, { fieldKeyType: FieldKeyType.Id });
      const afterRow = afterRecords.records[0];
      expect(afterRow.fields[linkField.id]).toBe(peerTitle);
      expect(afterRow.fields[lookupA.id]).toBe(peerTitle);
      expect(afterRow.fields[lookupB.id]).toBe(peerTitle);

      // Symmetric partner on the peer side: should still exist (NOT
      // cascade-deleted) and be converted to text holding the linked moving
      // record's primary value.
      const peerFieldsAfter = await getFields(peerTable.id);
      const symmetricAfter = peerFieldsAfter.find((f) => f.id === symmetricFieldId);
      expect(symmetricAfter).toBeDefined();
      expect(symmetricAfter!.type).toBe(FieldType.SingleLineText);
      const peerRecordsAfter = await getRecords(peerTable.id, { fieldKeyType: FieldKeyType.Id });
      const peerRowAfter = peerRecordsAfter.records[0];
      expect(peerRowAfter.fields[symmetricFieldId!]).toBe('row-1');
    });
  });

  // Contract: assertNoNewCrossSpaceField rejects any new Link / conditional
  // Lookup / conditional Rollup whose target table lives in another space.
  // This is the gate enforcing the "no new cross-space refs" rule the PR is
  // built around — without an e2e it can silently regress on any future
  // createField refactor.
  describe('cross-space field creation gate', () => {
    let spaceA: string;
    let spaceB: string;
    let baseA: string;
    let baseB: string;
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;

    beforeAll(async () => {
      spaceA = (await createSpace({ name: 'gate-a' })).id;
      spaceB = (await createSpace({ name: 'gate-b' })).id;
      baseA = (await createBase({ spaceId: spaceA, name: 'gate-base-a' })).id;
      baseB = (await createBase({ spaceId: spaceB, name: 'gate-base-b' })).id;
      tableA = (await createTable(baseA, { name: 'a' })).data;
      tableB = (await createTable(baseB, { name: 'b' })).data;
    });

    afterAll(async () => {
      await permanentDeleteSpace(spaceA);
      await permanentDeleteSpace(spaceB);
    });

    it('rejects a new cross-space Link field with 400', async () => {
      const fieldRo: IFieldRo = {
        name: 'cross_space_link',
        type: FieldType.Link,
        options: {
          baseId: baseB,
          relationship: Relationship.ManyOne,
          foreignTableId: tableB.id,
        } as ILinkFieldOptionsRo,
      };
      // createField helper returns {} when the response status matches the
      // expected non-2xx — that's our "rejected" signal. A 201 here would
      // make the helper throw, failing the test.
      const result = await createField(tableA.id, fieldRo, 400);
      expect(result).toEqual({});
    });

    it('allows same-space cross-base Link creation (sanity for the gate)', async () => {
      const baseA2 = (await createBase({ spaceId: spaceA, name: 'gate-base-a2' })).id;
      const tableA2 = (await createTable(baseA2, { name: 'a2' })).data;
      try {
        const fieldRo: IFieldRo = {
          name: 'same_space_link',
          type: FieldType.Link,
          options: {
            baseId: baseA2,
            relationship: Relationship.ManyOne,
            foreignTableId: tableA2.id,
          } as ILinkFieldOptionsRo,
        };
        const created = await createField(tableA.id, fieldRo);
        expect(created.type).toBe(FieldType.Link);
      } finally {
        await permanentDeleteBase(baseA2);
      }
    });
  });
});
