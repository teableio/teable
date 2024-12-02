import https from 'https';
import { join } from 'path';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  generateAccountId,
  generateSpaceId,
  generateUserId,
  minidenticon,
  Role,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, UploadType } from '@teable/openapi';
import type { IUserInfoVo, ICreateSpaceRo, IUserNotifyMeta } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import sharp from 'sharp';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { UserSignUpEvent } from '../../event-emitter/events/user/user.event';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { getFullStorageUrl } from '../attachments/plugins/utils';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  async getUserById(id: string) {
    const userRaw = await this.prismaService
      .txClient()
      .user.findUnique({ where: { id, deletedTime: null } });

    return (
      userRaw && {
        ...userRaw,
        avatar:
          userRaw.avatar &&
          getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), userRaw.avatar),
        notifyMeta: userRaw.notifyMeta && JSON.parse(userRaw.notifyMeta),
      }
    );
  }

  async getUserByEmail(email: string) {
    return await this.prismaService.txClient().user.findUnique({
      where: { email: email.toLowerCase(), deletedTime: null },
      include: { accounts: true },
    });
  }

  async createSpaceBySignup(createSpaceRo: ICreateSpaceRo) {
    const userId = this.cls.get('user.id');
    const uniqName = createSpaceRo.name ?? 'Space';

    const space = await this.prismaService.txClient().space.create({
      select: {
        id: true,
        name: true,
      },
      data: {
        id: generateSpaceId(),
        name: uniqName,
        createdBy: userId,
      },
    });
    await this.prismaService.txClient().collaborator.create({
      data: {
        resourceId: space.id,
        resourceType: CollaboratorType.Space,
        roleName: Role.Owner,
        userId,
        createdBy: userId,
      },
    });
    return space;
  }

  async createUserWithSettingCheck(
    user: Omit<Prisma.UserCreateInput, 'name'> & { name?: string },
    account?: Omit<Prisma.AccountUncheckedCreateInput, 'userId'>,
    defaultSpaceName?: string
  ) {
    const setting = await this.prismaService.setting.findFirst({
      select: {
        disallowSignUp: true,
      },
    });

    if (setting?.disallowSignUp) {
      throw new BadRequestException('The current instance disallow sign up by the administrator');
    }

    return await this.createUser(user, account, defaultSpaceName);
  }

  async createUser(
    user: Omit<Prisma.UserCreateInput, 'name'> & { name?: string },
    account?: Omit<Prisma.AccountUncheckedCreateInput, 'userId'>,
    defaultSpaceName?: string
  ) {
    // defaults
    const defaultNotifyMeta: IUserNotifyMeta = {
      email: true,
    };

    user = {
      ...user,
      id: user.id ?? generateUserId(),
      email: user.email.toLowerCase(),
      notifyMeta: JSON.stringify(defaultNotifyMeta),
    };

    const userTotalCount = await this.prismaService.txClient().user.count({
      where: { isSystem: null },
    });

    const isAdmin = !this.baseConfig.isCloud && userTotalCount === 0;

    if (!user?.avatar) {
      const avatar = await this.generateDefaultAvatar(user.id!);
      user = {
        ...user,
        avatar,
      };
    }
    // default space created
    const newUser = await this.prismaService.txClient().user.create({
      data: {
        ...user,
        name: user.name ?? user.email.split('@')[0],
        isAdmin: isAdmin ? true : null,
      },
    });
    const { id, name } = newUser;
    if (account) {
      await this.prismaService.txClient().account.create({
        data: { id: generateAccountId(), ...account, userId: id },
      });
    }
    await this.cls.runWith(this.cls.get(), async () => {
      this.cls.set('user.id', id);
      await this.createSpaceBySignup({ name: defaultSpaceName || `${name}'s space` });
    });
    return newUser;
  }

  async updateUserName(id: string, name: string) {
    const user: IUserInfoVo = await this.prismaService.txClient().user.update({
      data: {
        name,
      },
      where: { id, deletedTime: null },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });
    this.eventEmitterService.emitAsync(Events.USER_RENAME, user);
  }

  async updateAvatar(id: string, avatarFile: { path: string; mimetype: string; size: number }) {
    const path = join(StorageAdapter.getDir(UploadType.Avatar), id);
    const bucket = StorageAdapter.getBucket(UploadType.Avatar);
    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, avatarFile.path, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': avatarFile.mimetype,
    });
    const { size, mimetype } = avatarFile;

    await this.mountAttachment(id, {
      hash,
      size,
      mimetype,
      token: id,
      path,
    });

    await this.prismaService.txClient().user.update({
      data: {
        avatar: path,
      },
      where: { id, deletedTime: null },
    });
  }

  private async mountAttachment(
    userId: string,
    input: Prisma.AttachmentsCreateInput | Prisma.AttachmentsUpdateInput
  ) {
    await this.prismaService.txClient().attachments.upsert({
      create: {
        ...input,
        createdBy: userId,
      } as Prisma.AttachmentsCreateInput,
      update: input as Prisma.AttachmentsUpdateInput,
      where: {
        token: userId,
        deletedTime: null,
      },
    });
  }

  async updateNotifyMeta(id: string, notifyMetaRo: IUserNotifyMeta) {
    await this.prismaService.txClient().user.update({
      data: {
        notifyMeta: JSON.stringify(notifyMetaRo),
      },
      where: { id, deletedTime: null },
    });
  }

  private async generateDefaultAvatar(id: string) {
    const path = join(StorageAdapter.getDir(UploadType.Avatar), id);
    const bucket = StorageAdapter.getBucket(UploadType.Avatar);

    const svgSize = [410, 410];
    const svgString = minidenticon(id);
    const svgObject = sharp(Buffer.from(svgString))
      .resize(svgSize[0], svgSize[1])
      .flatten({ background: '#f0f0f0' })
      .png({ quality: 90 });
    const mimetype = 'image/png';
    const { size } = await svgObject.metadata();
    const svgBuffer = await svgObject.toBuffer();

    const { hash } = await this.storageAdapter.uploadFile(bucket, path, svgBuffer, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': mimetype,
    });

    await this.mountAttachment(id, {
      hash: hash,
      size: size,
      mimetype: mimetype,
      token: id,
      path: path,
      width: svgSize[0],
      height: svgSize[1],
    });

    return path;
  }

  private async uploadAvatarByUrl(userId: string, url: string) {
    return new Promise<string>((resolve, reject) => {
      https
        .get(url, async (stream) => {
          const contentType = stream?.headers?.['content-type']?.split(';')?.[0];
          const size = stream?.headers?.['content-length']?.split(';')?.[0];
          const path = join(StorageAdapter.getDir(UploadType.Avatar), userId);
          const bucket = StorageAdapter.getBucket(UploadType.Avatar);

          const { hash } = await this.storageAdapter.uploadFile(bucket, path, stream, {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': contentType,
          });

          await this.mountAttachment(userId, {
            hash: hash,
            size: size ? parseInt(size) : undefined,
            mimetype: contentType,
            token: userId,
            path: path,
          });
          resolve(path);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  async findOrCreateUser(user: {
    name: string;
    email: string;
    provider: string;
    providerId: string;
    type: string;
    avatarUrl?: string;
  }) {
    const res = await this.prismaService.$tx(async () => {
      const { email, name, provider, providerId, type, avatarUrl } = user;
      // account exist check
      const existAccount = await this.prismaService.txClient().account.findFirst({
        where: { provider, providerId },
      });
      if (existAccount) {
        return await this.getUserById(existAccount.userId);
      }

      // user exist check
      const existUser = await this.getUserByEmail(email);
      if (!existUser) {
        const userId = generateUserId();
        let avatar: string | undefined = undefined;
        if (avatarUrl) {
          avatar = await this.uploadAvatarByUrl(userId, avatarUrl);
        }
        return await this.createUserWithSettingCheck(
          { id: userId, email, name, avatar },
          { provider, providerId, type }
        );
      }

      await this.prismaService.txClient().account.create({
        data: { id: generateAccountId(), provider, providerId, type, userId: existUser.id },
      });
      return existUser;
    });
    if (res) {
      this.eventEmitterService.emitAsync(Events.USER_SIGNUP, new UserSignUpEvent(res.id));
    }
    return res;
  }

  async refreshLastSignTime(userId: string) {
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null },
      data: { lastSignTime: new Date().toISOString() },
    });
  }

  async getUserInfoList(userIds: string[]) {
    const userList = await this.prismaService.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });
    return userList.map((user) => {
      const { avatar } = user;
      return {
        ...user,
        avatar: avatar && getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), avatar),
      };
    });
  }

  async createSystemUser({
    id = generateUserId(),
    email,
    name,
    avatar,
  }: {
    id?: string;
    email: string;
    name: string;
    avatar?: string;
  }) {
    return this.prismaService.$tx(async () => {
      if (!avatar) {
        avatar = await this.generateDefaultAvatar(id);
      }
      return this.prismaService.txClient().user.create({
        data: {
          id,
          email,
          name,
          avatar,
          isSystem: true,
        },
      });
    });
  }
}
