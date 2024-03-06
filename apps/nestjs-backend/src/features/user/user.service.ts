import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { generateSpaceId, minidenticon, SpaceRole } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import { type ICreateSpaceRo, type IUserNotifyMeta, UploadType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import sharp from 'sharp';
import type { IClsStore } from '../../types/cls';
import { FileUtils } from '../../utils';
import { getFullStorageUrl } from '../../utils/full-storage-url';
import StorageAdapter from '../attachments/plugins/adapter';
import { LocalStorage } from '../attachments/plugins/local';
import { InjectStorageAdapter } from '../attachments/plugins/storage';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter
  ) {}

  async getUserById(id: string) {
    const userRaw = await this.prismaService
      .txClient()
      .user.findUnique({ where: { id, deletedTime: null } });

    return (
      userRaw && {
        ...userRaw,
        avatar: userRaw.avatar && getFullStorageUrl(userRaw.avatar),
        notifyMeta: userRaw.notifyMeta && JSON.parse(userRaw.notifyMeta),
      }
    );
  }

  async getUserByEmail(email: string) {
    return await this.prismaService
      .txClient()
      .user.findUnique({ where: { email, deletedTime: null } });
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
        lastModifiedBy: userId,
      },
    });
    await this.prismaService.txClient().collaborator.create({
      data: {
        spaceId: space.id,
        roleName: SpaceRole.Owner,
        userId,
        createdBy: userId,
        lastModifiedBy: userId,
      },
    });
    return space;
  }

  async createUser(user: Prisma.UserCreateInput) {
    // defaults
    const defaultNotifyMeta: IUserNotifyMeta = {
      email: true,
    };

    user = {
      ...user,
      notifyMeta: JSON.stringify(defaultNotifyMeta),
    };

    if (!user?.avatar) {
      const avatar = await this.generateDefaultAvatar(user.id!);
      user = {
        ...user,
        avatar,
      };
    }

    // default space created
    return await this.prismaService.$tx(async (prisma) => {
      const newUser = await prisma.user.create({ data: user });
      const { id, name } = newUser;
      await this.cls.runWith(this.cls.get(), async () => {
        this.cls.set('user.id', id);
        await this.createSpaceBySignup({ name: `${name}'s space` });
      });
      return newUser;
    });
  }

  async updateUserName(id: string, name: string) {
    await this.prismaService.txClient().user.update({
      data: {
        name,
      },
      where: { id, deletedTime: null },
    });
  }

  async updateAvatar(id: string, avatarFile: Express.Multer.File) {
    const path = join(StorageAdapter.getDir(UploadType.Avatar), id);
    const bucket = StorageAdapter.getBucket(UploadType.Avatar);
    const url = await this.storageAdapter.uploadFileWidthPath(bucket, path, avatarFile.path, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': avatarFile.mimetype,
    });

    const { size, mimetype, path: filePath } = avatarFile;
    let hash, width, height;

    const storage = this.storageAdapter;
    if (storage instanceof LocalStorage) {
      hash = await FileUtils.getHash(filePath);
      const fileMate = await storage.getFileMate(filePath);
      width = fileMate.width;
      height = fileMate.height;
    } else {
      const objectMeta = await storage.getObjectMeta(bucket, path, id);
      hash = objectMeta.hash;
      width = objectMeta.width;
      height = objectMeta.height;
    }

    await this.mountAttachment(id, {
      bucket,
      hash,
      size,
      mimetype,
      token: id,
      path,
      width,
      height,
    });

    await this.prismaService.txClient().user.update({
      data: {
        avatar: url,
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
        lastModifiedBy: userId,
      } as Prisma.AttachmentsCreateInput,
      update: {
        ...input,
        lastModifiedBy: userId,
      } as Prisma.AttachmentsUpdateInput,
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
    const { size } = await svgObject.metadata();
    const svgBuffer = await svgObject.toBuffer();
    const svgHash = await FileUtils.getHash(svgBuffer);

    await this.mountAttachment(id, {
      bucket: bucket,
      hash: svgHash,
      size: size,
      mimetype: 'image/png',
      token: id,
      path: path,
      width: svgSize[0],
      height: svgSize[1],
    });

    return this.storageAdapter.uploadFile(bucket, path, svgBuffer, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'image/png',
    });
  }
}
