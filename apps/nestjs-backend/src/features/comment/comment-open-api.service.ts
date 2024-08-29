import { Injectable, Logger } from '@nestjs/common';
import { generateCommentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateCommentRo, ICommentVo, IUpdateCommentRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { NotificationService } from '../notification/notification.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';

@Injectable()
export class CommentOpenApiService {
  private logger = new Logger(CommentOpenApiService.name);
  constructor(
    private readonly notificationService: NotificationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async getCommentList(tableId: string, recordId: string) {
    return (await this.prismaService.comment.findMany({
      where: {
        recordId,
        tableId,
        deletedTime: null,
      },
      select: {
        id: true,
        content: true,
        createdBy: true,
        lastModifiedBy: true,
        createdTime: true,
        lastModifiedTime: true,
      },
    })) as ICommentVo[];
  }

  async createComment(tableId: string, recordId: string, createCommentRo: ICreateCommentRo) {
    const id = generateCommentId();
    await this.prismaService.comment.create({
      data: {
        id,
        tableId,
        recordId,
        content: JSON.stringify(createCommentRo.content),
        createdBy: this.cls.get('user.id'),
      },
    });

    return {
      id,
      content: createCommentRo.content,
    };
  }

  async updateComment(commentId: string, updateCommentRo: IUpdateCommentRo) {
    await this.prismaService.comment.update({
      where: {
        id: commentId,
      },
      data: {
        lastModifiedBy: this.cls.get('user.id'),
        content: JSON.stringify(updateCommentRo.content),
      },
    });
  }

  async deleteComment(commentId: string) {
    await this.prismaService.comment.delete({
      where: {
        id: commentId,
      },
    });
  }
}
