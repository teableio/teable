import {
  BadRequestException,
  Body,
  Controller,
  Patch,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IUpdateUserNameRo,
  IUserNotifyMeta,
  updateUserNameRoSchema,
  userNotifyMetaSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { UserService } from './user.service';

@Controller('api/user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Patch('name')
  async updateName(
    @Body(new ZodValidationPipe(updateUserNameRoSchema)) updateUserNameRo: IUpdateUserNameRo
  ): Promise<void> {
    const userId = this.cls.get('user.id');
    return this.userService.updateUserName(userId, updateUserNameRo.name);
  }

  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req, file, callback) => {
        if (file.mimetype.startsWith('image/')) {
          callback(null, true);
        } else {
          callback(new BadRequestException('Invalid file type'), false);
        }
      },
      limits: {
        fileSize: 3 * 1024 * 1024, // limit file size is 3MB
      },
    })
  )
  @Patch('avatar')
  async updateAvatar(@UploadedFile() file: Express.Multer.File): Promise<void> {
    const userId = this.cls.get('user.id');
    return this.userService.updateAvatar(userId, file);
  }

  @Patch('notify-meta')
  async updateNotifyMeta(
    @Body(new ZodValidationPipe(userNotifyMetaSchema))
    updateUserNotifyMetaRo: IUserNotifyMeta
  ): Promise<void> {
    const userId = this.cls.get('user.id');
    return this.userService.updateNotifyMeta(userId, updateUserNotifyMetaRo);
  }
}
