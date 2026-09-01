import type { INestApplication } from '@nestjs/common';
import { Role } from '@teable/core';
import type { UniqueUserCollaboratorItem } from '@teable/openapi';
import {
  createBase,
  createSpace as apiCreateSpace,
  deleteSpaceBaseCollaborators,
  emailBaseInvitation,
  emailSpaceInvitation,
  getSpaceCollaboratorList,
  getSpaceUniqueCollaboratorList,
  PrincipalType,
} from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { initApp, permanentDeleteSpace } from './utils/init-app';

describe('OpenAPI space unique collaborator list (e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  const memberEmail = 'unique-member@example.com';
  const baseOnlyEmail = 'unique-base-only@example.com';

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    // ensure the invited accounts exist
    await createNewUserAxios({ email: memberEmail, password: '12345678' });
    await createNewUserAxios({ email: baseOnlyEmail, password: '12345678' });

    spaceId = (await apiCreateSpace({ name: 'unique collaborator space' })).data.id;
    const base1 = (await createBase({ spaceId, name: 'base 1' })).data;
    const base2 = (await createBase({ spaceId, name: 'base 2' })).data;

    // member: space-level role only
    await emailSpaceInvitation({
      spaceId,
      emailSpaceInvitationRo: { emails: [memberEmail], role: Role.Editor },
    });
    // base-only collaborator: granted on both bases, no space role
    await emailBaseInvitation({
      baseId: base1.id,
      emailBaseInvitationRo: { emails: [baseOnlyEmail], role: Role.Editor },
    });
    await emailBaseInvitation({
      baseId: base2.id,
      emailBaseInvitationRo: { emails: [baseOnlyEmail], role: Role.Viewer },
    });
  });

  afterAll(async () => {
    await permanentDeleteSpace(spaceId);
    await app.close();
  });

  const findByEmail = (collaborators: UniqueUserCollaboratorItem[], email: string) =>
    collaborators.find((collaborator) => collaborator.email === email);

  it('deduplicates principals with space role and base count', async () => {
    const { collaborators, total } = (await getSpaceUniqueCollaboratorList(spaceId)).data;
    const users = collaborators as UniqueUserCollaboratorItem[];

    // owner + member + base-only collaborator, one entry each
    expect(total).toBe(3);
    expect(users).toHaveLength(3);

    const member = findByEmail(users, memberEmail);
    expect(member?.spaceRole).toBe(Role.Editor);
    expect(member?.baseCount).toBe(0);

    const baseOnly = findByEmail(users, baseOnlyEmail);
    expect(baseOnly?.spaceRole).toBeNull();
    expect(baseOnly?.baseCount).toBe(2);

    // the row-level list counts rows, the unique list counts principals
    const rowLevel = (await getSpaceCollaboratorList(spaceId, { includeBase: true })).data;
    expect(rowLevel.total).toBe(4);
    expect(rowLevel.uniqTotal).toBe(3);
  });

  it('paginates principals with a stable total', async () => {
    const firstPage = (await getSpaceUniqueCollaboratorList(spaceId, { take: 2 })).data;
    expect(firstPage.collaborators).toHaveLength(2);
    expect(firstPage.total).toBe(3);

    const secondPage = (await getSpaceUniqueCollaboratorList(spaceId, { take: 2, skip: 2 })).data;
    expect(secondPage.collaborators).toHaveLength(1);
    expect(secondPage.total).toBe(3);

    const firstIds = firstPage.collaborators.map((collaborator) =>
      collaborator.type === PrincipalType.User ? collaborator.userId : collaborator.departmentId
    );
    const secondIds = secondPage.collaborators.map((collaborator) =>
      collaborator.type === PrincipalType.User ? collaborator.userId : collaborator.departmentId
    );
    expect(firstIds).not.toEqual(expect.arrayContaining(secondIds));
  });

  it('filters unique principals by search', async () => {
    const { collaborators, total } = (
      await getSpaceUniqueCollaboratorList(spaceId, { search: 'unique-base-only' })
    ).data;
    expect(total).toBe(1);
    expect(collaborators).toHaveLength(1);
    expect((collaborators[0] as UniqueUserCollaboratorItem).email).toBe(baseOnlyEmail);
  });

  it('returns one principal permission rows via principalId filter', async () => {
    const unique = (await getSpaceUniqueCollaboratorList(spaceId)).data;
    const baseOnly = findByEmail(
      unique.collaborators as UniqueUserCollaboratorItem[],
      baseOnlyEmail
    );
    expect(baseOnly).toBeDefined();

    const { collaborators } = (
      await getSpaceCollaboratorList(spaceId, {
        includeBase: true,
        principalId: baseOnly!.userId,
      })
    ).data;
    expect(collaborators).toHaveLength(2);
    expect(
      collaborators.every(
        (collaborator) =>
          collaborator.type === PrincipalType.User && collaborator.userId === baseOnly!.userId
      )
    ).toBe(true);
    const baseNames = collaborators.map((collaborator) => collaborator.base?.name).sort();
    expect(baseNames).toEqual(['base 1', 'base 2']);
  });

  it('removes every base grant of a principal via the space-level endpoint', async () => {
    const before = (await getSpaceUniqueCollaboratorList(spaceId)).data;
    const baseOnly = findByEmail(
      before.collaborators as UniqueUserCollaboratorItem[],
      baseOnlyEmail
    );
    expect(baseOnly).toBeDefined();

    await deleteSpaceBaseCollaborators({
      spaceId,
      deleteSpaceCollaboratorRo: {
        principalId: baseOnly!.userId,
        principalType: PrincipalType.User,
      },
    });

    const after = (await getSpaceUniqueCollaboratorList(spaceId)).data;
    expect(after.total).toBe(2);
    expect(
      findByEmail(after.collaborators as UniqueUserCollaboratorItem[], baseOnlyEmail)
    ).toBeUndefined();
  });
});
