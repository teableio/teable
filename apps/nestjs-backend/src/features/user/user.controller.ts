import { Body, Controller, Patch } from '@nestjs/common';
import {
  IUpdateUserAvatarRo,
  IUpdateUserNameRo,
  IUserNotifyMeta,
  updateUserAvatarRoSchema,
  updateUserNameRoSchema,
  userNotifyMetaSchema,
} from '@teable-group/openapi';
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

  @Patch('updateName')
  async updateName(
    @Body(new ZodValidationPipe(updateUserNameRoSchema)) updateUserNameRo: IUpdateUserNameRo
  ): Promise<void> {
    const userId = this.cls.get('user.id');
    return this.userService.updateUserName(userId, updateUserNameRo.name);
  }

  @Patch('updateAvatar')
  async updateAvatar(
    @Body(new ZodValidationPipe(updateUserAvatarRoSchema)) updateUserAvatarRo: IUpdateUserAvatarRo
  ): Promise<void> {
    const userId = this.cls.get('user.id');
    return this.userService.updateAvatar(userId, updateUserAvatarRo.avatar);
  }

  @Patch('updateNotifyMeta')
  async updateNotifyMeta(
    @Body(new ZodValidationPipe(userNotifyMetaSchema))
    updateUserNotifyMetaRo: IUserNotifyMeta
  ): Promise<void> {
    const userId = this.cls.get('user.id');
    return this.userService.updateNotifyMeta(userId, updateUserNotifyMetaRo);
  }
}
