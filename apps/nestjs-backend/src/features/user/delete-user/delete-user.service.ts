/* eslint-disable sonarjs/no-duplicate-string */
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { getRandomString, HttpErrorCode, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IDeleteUserBlockingSpace } from '@teable/openapi';
import {
  CollaboratorType,
  PluginStatus,
  PrincipalType,
  ResourceType,
  UploadType,
} from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';

/** What a deletion took along with the account. */
export interface IDeletedUserSummary {
  /** Spaces the user alone owned, moved to trash with the account. */
  trashedSpaceIds: string[];
}

@Injectable()
export class DeleteUserService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly prismaService: PrismaService,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async updateUserAvatarToDeleted(userId: string) {
    const path = join(StorageAdapter.getDir(UploadType.Avatar), userId);
    const bucket = StorageAdapter.getBucket(UploadType.Avatar);
    const mimetype = `image/png`;
    const { hash } = await this.storageAdapter.uploadFileWidthPath(
      bucket,
      path,
      'static/system/deleted-user-avatar.png',
      {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': mimetype,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Cache-Control': StorageAdapter.getCacheControl(UploadType.Avatar),
      }
    );
    await this.prismaService.txClient().attachments.update({
      data: {
        hash,
      },
      where: {
        token: userId,
        deletedTime: null,
      },
    });
    // Bump the version query so urls cached with the real photo stop being
    // referenced; without this, browsers/CDN keep serving the old bytes for
    // the full max-age window after deletion. The user row is already
    // soft-deleted at this point, so no deletedTime filter here.
    await this.prismaService.txClient().user.update({
      data: {
        avatar: `${path}?v=${Date.now()}`,
      },
      where: { id: userId },
    });
  }

  private async permanentlyDeleteUser(userId: string) {
    await this.prismaService.txClient().user.update({
      where: { id: userId, permanentDeletedTime: null },
      data: {
        email: `deleted-${getRandomString(10)}@teable.ai`,
        name: 'Deleted User',
        permanentDeletedTime: new Date().toISOString(),
        deletedTime: new Date().toISOString(),
      },
    });
    // update user avatar to default avatar
    await this.updateUserAvatarToDeleted(userId);
  }

  private async clearUserData(userId: string) {
    // clear user data
    // clear token
    await this.prismaService.txClient().accessToken.deleteMany({
      where: {
        userId,
      },
    });
    // clear account
    await this.prismaService.txClient().account.deleteMany({
      where: {
        userId,
      },
    });
    // clear comment subscription
    await this.prismaService.txClient().commentSubscription.deleteMany({
      where: {
        createdBy: userId,
      },
    });
    // clear invitation
    await this.prismaService.txClient().invitation.deleteMany({
      where: {
        createdBy: userId,
      },
    });
    // clear notification
    await this.prismaService.txClient().notification.deleteMany({
      where: {
        toUserId: userId,
      },
    });
    // clear Oauth app
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex('oauth_app_token as t')
          .join('oauth_app_secret as s', 't.app_secret_id', 's.id')
          .join('oauth_app as a', 's.client_id', 'a.client_id')
          .where('a.created_by', userId)
          .del()
          .toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex('oauth_app_secret as s')
          .join('oauth_app as a', 's.client_id', 'a.client_id')
          .where('a.created_by', userId)
          .del()
          .toQuery()
      );
    await this.prismaService
      .txClient()
      .$executeRawUnsafe(
        this.knex('oauth_app_authorized as auth')
          .join('oauth_app as a', 'auth.client_id', 'a.client_id')
          .where('a.created_by', userId)
          .del()
          .toQuery()
      );
    await this.prismaService.txClient().oAuthApp.deleteMany({
      where: {
        createdBy: userId,
      },
    });
    // clear Pin
    await this.prismaService.txClient().pinResource.deleteMany({
      where: {
        createdBy: userId,
      },
    });
    // clear Plugin develop
    await this.prismaService.txClient().plugin.deleteMany({
      where: {
        createdBy: userId,
        status: {
          not: PluginStatus.Published,
        },
      },
    });
    // clear user last visit
    await this.prismaService.txClient().userLastVisit.deleteMany({
      where: {
        userId,
      },
    });

    // clear collaborator
    await this.prismaService.txClient().collaborator.deleteMany({
      where: {
        principalId: userId,
      },
    });
  }

  /**
   * Editions can annotate the spaces the user still has to settle, e.g. flag
   * the ones whose subscription must be cancelled before they can be deleted.
   */
  protected async describeSoleOwnerSpaces(
    spaces: IDeleteUserBlockingSpace[]
  ): Promise<IDeleteUserBlockingSpace[]> {
    return spaces;
  }

  /**
   * The live spaces this user is the only owner of, annotated by the edition. These are
   * what leaves with the account: each goes to trash together with it, unless the user
   * hands it to another member first. Every other membership is simply dropped, and spaces
   * already in trash wait for the retention cleanup.
   */
  async listSoleOwnerSpaces(userId = this.cls.get('user.id')): Promise<IDeleteUserBlockingSpace[]> {
    const soleOwnerSpaces = await this.prismaService.txClient().$queryRawUnsafe<
      {
        id: string;
        name: string;
        hasOtherMembers: boolean | number;
      }[]
    >(
      this.knex
        .select({
          id: 'space.id',
          name: 'space.name',
        })
        .select(
          this.knex.raw('exists ? as ??', [
            this.knex
              .select(this.knex.raw('1'))
              .from('collaborator as member')
              .whereRaw('member.resource_id = space.id')
              .where('member.resource_type', CollaboratorType.Space)
              .whereNot((d) =>
                d
                  .where('member.principal_id', userId)
                  .where('member.principal_type', PrincipalType.User)
              ),
            'hasOtherMembers',
          ])
        )
        .from('collaborator')
        .innerJoin('space', 'collaborator.resource_id', 'space.id')
        .where('collaborator.principal_id', userId)
        .where('collaborator.principal_type', PrincipalType.User)
        .where('collaborator.resource_type', CollaboratorType.Space)
        .where('collaborator.role_name', Role.Owner)
        .whereNull('space.deleted_time')
        .whereNotExists(
          this.knex
            .select(this.knex.raw('1'))
            .from('collaborator as other')
            .whereRaw('other.resource_id = space.id')
            .where('other.resource_type', CollaboratorType.Space)
            .where('other.role_name', Role.Owner)
            .whereNot((d) =>
              d
                .where('other.principal_id', userId)
                .where('other.principal_type', PrincipalType.User)
            )
        )
        .toQuery()
    );
    if (soleOwnerSpaces.length === 0) return [];
    return this.describeSoleOwnerSpaces(
      soleOwnerSpaces.map(({ id, name, hasOtherMembers }) => ({
        id,
        name,
        hasOtherMembers: Boolean(hasOtherMembers),
      }))
    );
  }

  /** Returns the ids of the spaces it moved to trash. */
  private async settleOwnedSpaces(
    userId: string,
    acknowledgedSpaceIds: string[]
  ): Promise<string[]> {
    const spaces = await this.listSoleOwnerSpaces(userId);
    if (spaces.length === 0) return [];

    // A subscribed space cannot be trashed at all; the others need the user's
    // acknowledgement before they are trashed on the user's behalf. The page lists them
    // before the first press, so this only fires when a space appeared in between.
    const acknowledged = new Set(acknowledgedSpaceIds);
    const pending = spaces.filter((space) => space.subscribed || !acknowledged.has(space.id));
    if (pending.length > 0) {
      throw new CustomHttpException(
        'User is the only owner of spaces that must be acknowledged or handed over first: ' +
          pending.map((space) => space.name).join(', '),
        HttpErrorCode.VALIDATION_ERROR,
        {
          spaces,
          localization: {
            i18nKey: 'httpErrors.user.soleOwnerOfSpaces',
          },
        }
      );
    }

    // Same as a manual delete: the space is soft deleted and recorded in
    // trash, so the retention cleanup removes it later.
    const deletedTime = new Date();
    for (const space of spaces) {
      await this.prismaService.txClient().space.update({
        where: { id: space.id, deletedTime: null },
        data: { deletedTime, lastModifiedBy: userId },
      });
      await this.prismaService.txClient().trash.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          resourceType_resourceId: { resourceType: ResourceType.Space, resourceId: space.id },
        },
        create: {
          resourceId: space.id,
          resourceType: ResourceType.Space,
          deletedTime,
          deletedBy: userId,
        },
        update: { deletedTime, deletedBy: userId },
      });
    }
    return spaces.map((space) => space.id);
  }

  async deleteUserById(
    userId: string,
    acknowledgedSpaceIds: string[] = []
  ): Promise<IDeletedUserSummary> {
    return await this.prismaService.$tx(async () => {
      const trashedSpaceIds = await this.settleOwnedSpaces(userId, acknowledgedSpaceIds);
      await this.clearUserData(userId);
      await this.permanentlyDeleteUser(userId);
      return { trashedSpaceIds };
    });
  }

  async deleteUser(acknowledgedSpaceIds: string[] = []): Promise<IDeletedUserSummary> {
    const userId = this.cls.get('user.id');
    return await this.deleteUserById(userId, acknowledgedSpaceIds);
  }
}
