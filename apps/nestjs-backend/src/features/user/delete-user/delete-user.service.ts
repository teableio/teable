/* eslint-disable sonarjs/no-duplicate-string */
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { getRandomString, HttpErrorCode, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginStatus, PrincipalType, UploadType } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';

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

  private async validateDeleteUser(userId: string) {
    const collaboratorSpaces = await this.prismaService.txClient().$queryRawUnsafe<
      {
        id: string;
        name: string;
        deletedTime: string | null;
      }[]
    >(
      this.knex
        .queryBuilder()
        .select({
          id: 'space.id',
          name: 'space.name',
          deletedTime: 'space.deleted_time',
        })
        .from('collaborator')
        .innerJoin('space', 'collaborator.resource_id', 'space.id')
        .where('principal_id', userId)
        .where('principal_type', PrincipalType.User)
        .where((d1) =>
          d1
            .where((d2) =>
              d2
                .whereIn('collaborator.role_name', [Role.Owner, Role.Creator])
                .whereNotNull('space.deleted_time')
            )
            .orWhereNull('space.deleted_time')
        )
        .toQuery()
    );
    if (collaboratorSpaces.length > 0) {
      throw new CustomHttpException(
        'User has collaborators in spaces (or deleted spaces in trash): ' +
          collaboratorSpaces.map((space) => space.name).join(', '),
        HttpErrorCode.VALIDATION_ERROR,
        {
          spaces: collaboratorSpaces.map((space) => ({
            id: space.id,
            name: space.name,
            deletedTime: space.deletedTime ? new Date(space.deletedTime).toISOString() : null,
          })),
        }
      );
    }
  }

  async deleteUserById(userId: string) {
    await this.prismaService.$tx(async () => {
      await this.validateDeleteUser(userId);
      await this.clearUserData(userId);
      await this.permanentlyDeleteUser(userId);
    });
  }

  async deleteUser() {
    const userId = this.cls.get('user.id');
    await this.deleteUserById(userId);
  }
}
