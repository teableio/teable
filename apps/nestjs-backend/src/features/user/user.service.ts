import https from 'https';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import {
  generateAccountId,
  generateSpaceId,
  generateUserId,
  HttpErrorCode,
  minidenticon,
  Role,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PrincipalType, UploadType } from '@teable/openapi';
import type { IUserInfoVo, ICreateSpaceRo, IUserNotifyMeta } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { I18nContext } from 'nestjs-i18n';
import sharp from 'sharp';
import { CacheService } from '../../cache/cache.service';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { CustomHttpException } from '../../custom.exception';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { UserSignUpEvent } from '../../event-emitter/events/user/user.event';
import type { IClsStore } from '../../types/cls';
import StorageAdapter from '../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../attachments/plugins/storage';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { UserModel } from '../model/user';
import { SettingService } from '../setting/setting.service';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService,
    private readonly settingService: SettingService,
    private readonly cacheService: CacheService,
    private readonly userModel: UserModel,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {}

  async getUserById(id: string) {
    const userRaw = await this.userModel.getUserRawById(id);

    return (
      userRaw && {
        ...userRaw,
        avatar: userRaw.avatar && getPublicFullStorageUrl(userRaw.avatar),
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
        principalType: PrincipalType.User,
        principalId: userId,
        createdBy: userId,
      },
    });
    return space;
  }

  async createUserWithSettingCheck(
    user: Omit<Prisma.UserCreateInput, 'name'> & { name?: string },
    account?: Omit<Prisma.AccountUncheckedCreateInput, 'userId'>,
    defaultSpaceName?: string,
    inviteCode?: string,
    autoSpaceCreation: boolean = true
  ) {
    const setting = await this.settingService.getSetting();
    if (setting?.disallowSignUp) {
      throw new CustomHttpException(
        'The current instance disallow sign up by the administrator',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.user.disallowSignUp',
          },
        }
      );
    }
    if (setting.enableWaitlist) {
      await this.checkWaitlistInviteCode(inviteCode);
    }

    return await this.createUser(user, account, defaultSpaceName, autoSpaceCreation);
  }

  async checkWaitlistInviteCode(inviteCode?: string) {
    if (!inviteCode) {
      throw new CustomHttpException(
        'Waitlist is enabled, invite code is required',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.user.waitlistInviteCodeRequired',
          },
        }
      );
    }

    const times = await this.cacheService.get(`waitlist:invite-code:${inviteCode}`);
    if (!times || times <= 0) {
      throw new CustomHttpException(
        'Waitlist is enabled, invite code is invalid',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.user.waitlistInviteCodeInvalid',
          },
        }
      );
    }

    await this.cacheService.set(`waitlist:invite-code:${inviteCode}`, times - 1, '30d');

    return true;
  }

  async createUser(
    user: Omit<Prisma.UserCreateInput, 'name'> & { name?: string },
    account?: Omit<Prisma.AccountUncheckedCreateInput, 'userId'>,
    defaultSpaceName?: string,
    autoSpaceCreation: boolean = true
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

    const isAdmin = userTotalCount === 0;

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
        lang: I18nContext.current()?.lang,
      },
    });
    const { id, name } = newUser;
    if (account) {
      await this.prismaService.txClient().account.create({
        data: { id: generateAccountId(), ...account, userId: id },
      });
    }
    if (this.baseConfig.isCloud && autoSpaceCreation) {
      await this.cls.runWith(this.cls.get(), async () => {
        this.cls.set('user.id', id);
        await this.createSpaceBySignup({ name: defaultSpaceName || `${name}'s space` });
      });
    }
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

  // Avatar size for cropping (square)
  private static readonly avatarSize = 128;
  private static readonly avatarMimetype = 'image/webp';

  async updateAvatar(id: string, avatarFile: { path: string; mimetype: string; size: number }) {
    const storagePath = join(StorageAdapter.getDir(UploadType.Avatar), id);
    const bucket = StorageAdapter.getBucket(UploadType.Avatar);

    // Crop the image to a square before uploading
    const croppedImageBuffer = await this.cropAvatarImage(avatarFile.path);

    // Upload the cropped image buffer directly
    const { hash } = await this.storageAdapter.uploadFile(bucket, storagePath, croppedImageBuffer, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': UserService.avatarMimetype,
    });

    await this.mountAttachment(id, {
      hash,
      size: croppedImageBuffer.length,
      mimetype: UserService.avatarMimetype,
      token: id,
      path: storagePath,
    });

    await this.prismaService.txClient().user.update({
      data: {
        avatar: storagePath,
      },
      where: { id, deletedTime: null },
    });
  }

  /**
   * Crop avatar image to a square (center crop) and resize to avatarSize
   * Output format is WebP for better compression
   */
  private async cropAvatarImage(filePath: string): Promise<Buffer> {
    try {
      const image = sharp(filePath, { failOn: 'none' });
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        throw new CustomHttpException('Unsupported file type', HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: 'httpErrors.attachment.invalidImage',
          },
        });
      }

      // Center crop to square
      const size = Math.min(metadata.width, metadata.height);
      const left = Math.floor((metadata.width - size) / 2);
      const top = Math.floor((metadata.height - size) / 2);

      return await image
        .extract({ left, top, width: size, height: size })
        .resize(UserService.avatarSize, UserService.avatarSize)
        .webp({ quality: 85 })
        .toBuffer();
    } catch (error) {
      // If it's already a CustomHttpException, rethrow it
      if (error instanceof CustomHttpException) {
        throw error;
      }
      // For any other errors (e.g., unsupported format, corrupted file), throw 400
      throw new CustomHttpException('Unsupported file type', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidImage',
        },
      });
    }
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

  async updateLang(id: string, lang: string) {
    await this.prismaService.txClient().user.update({
      data: {
        lang,
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
        .get(url, async (response) => {
          try {
            // Collect the image data into a buffer
            const chunks: Buffer[] = [];
            for await (const chunk of response) {
              chunks.push(chunk);
            }
            const imageBuffer = Buffer.concat(chunks);

            // Crop the image to square and resize
            const croppedBuffer = await this.cropAvatarBuffer(imageBuffer);

            const storagePath = join(StorageAdapter.getDir(UploadType.Avatar), userId);
            const bucket = StorageAdapter.getBucket(UploadType.Avatar);
            const { hash } = await this.storageAdapter.uploadFile(
              bucket,
              storagePath,
              croppedBuffer,
              {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': UserService.avatarMimetype,
              }
            );

            await this.mountAttachment(userId, {
              hash: hash,
              size: croppedBuffer.length,
              mimetype: UserService.avatarMimetype,
              token: userId,
              path: storagePath,
            });
            resolve(storagePath);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Crop avatar image buffer to a square (center crop) and resize to avatarSize
   * Output format is WebP for better compression
   */
  private async cropAvatarBuffer(imageBuffer: Buffer): Promise<Buffer> {
    const image = sharp(imageBuffer, { failOn: 'none' });
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      // If we can't get metadata, just resize without center crop
      return image
        .resize(UserService.avatarSize, UserService.avatarSize)
        .webp({ quality: 85 })
        .toBuffer();
    }

    // Center crop to square
    const size = Math.min(metadata.width, metadata.height);
    const left = Math.floor((metadata.width - size) / 2);
    const top = Math.floor((metadata.height - size) / 2);

    return image
      .extract({ left, top, width: size, height: size })
      .resize(UserService.avatarSize, UserService.avatarSize)
      .webp({ quality: 85 })
      .toBuffer();
  }

  async findOrCreateUser(
    user: {
      name: string;
      email: string;
      provider: string;
      providerId: string;
      type: string;
      avatarUrl?: string;
    },
    autoSpaceCreation: boolean = true,
    onCreateNewUser?: () => void
  ) {
    let isNewUser = false;
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
      if (existUser && existUser.isSystem) {
        throw new CustomHttpException('User is system user', HttpErrorCode.UNAUTHORIZED, {
          localization: {
            i18nKey: 'httpErrors.user.systemUser',
          },
        });
      }
      if (!existUser) {
        const userId = generateUserId();
        let avatar: string | undefined = undefined;
        if (avatarUrl) {
          try {
            avatar = await this.uploadAvatarByUrl(userId, avatarUrl);
          } catch {
            // Ignore avatar upload errors, don't block user login
          }
        }
        isNewUser = true;
        onCreateNewUser?.();
        return await this.createUserWithSettingCheck(
          { id: userId, email, name, avatar },
          { provider, providerId, type },
          undefined,
          undefined,
          autoSpaceCreation
        );
      }

      await this.prismaService.txClient().account.create({
        data: { id: generateAccountId(), provider, providerId, type, userId: existUser.id },
      });
      return existUser;
    });
    if (res && isNewUser) {
      this.eventEmitterService.emitAsync(Events.USER_SIGNUP, new UserSignUpEvent(res.id));
    }
    return res;
  }

  async refreshLastSignTime(userId: string) {
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null },
      data: { lastSignTime: new Date().toISOString() },
    });
    this.eventEmitterService.emitAsync(Events.USER_SIGNIN, { userId });
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
        avatar: avatar && getPublicFullStorageUrl(avatar),
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
