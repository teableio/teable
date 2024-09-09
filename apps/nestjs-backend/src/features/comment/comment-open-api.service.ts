import { Injectable, Logger, ForbiddenException, BadGatewayException } from '@nestjs/common';
import { generateCommentId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateCommentRo, ICommentVo, IUpdateCommentRo } from '@teable/openapi';
import { uniq } from 'lodash';
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

  async getCommentDetail(commentId: string) {
    const rawComment = await this.prismaService.comment.findFirst({
      where: {
        id: commentId,
      },
      select: {
        id: true,
        content: true,
        createdBy: true,
        createdTime: true,
        lastModifiedTime: true,
        deletedTime: true,
        quoteId: true,
      },
    });

    if (!rawComment) {
      throw new ForbiddenException('Comment not found');
    }

    return {
      ...rawComment,
      content: rawComment?.content ? JSON.parse(rawComment?.content) : null,
    } as ICommentVo;
  }

  async getCommentList(tableId: string, recordId: string) {
    const rawComments = await this.prismaService.comment.findMany({
      where: {
        recordId,
        tableId,
        deletedTime: null,
      },
      orderBy: {
        createdTime: 'asc',
      },
      select: {
        id: true,
        content: true,
        createdBy: true,
        createdTime: true,
        lastModifiedTime: true,
        quoteId: true,
        reaction: true,
      },
    });

    return rawComments.map(
      (comment) =>
        ({
          ...comment,
          content: comment.content ? JSON.parse(comment.content) : null,
          reaction: comment.reaction ? JSON.parse(comment.reaction) : null,
        }) as ICommentVo
    ) as ICommentVo[];
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
        quoteId: createCommentRo.quoteId,
        lastModifiedTime: null,
      },
    });

    return {
      id,
      content: createCommentRo.content,
    };
  }

  async updateComment(commentId: string, updateCommentRo: IUpdateCommentRo) {
    await this.prismaService.comment
      .update({
        where: {
          id: commentId,
          createdBy: this.cls.get('user.id'),
        },
        data: {
          content: JSON.stringify(updateCommentRo.content),
          lastModifiedTime: new Date().toISOString(),
        },
      })
      .catch(() => {
        throw new ForbiddenException('You have no permission to delete this comment');
      });
  }

  async deleteComment(commentId: string) {
    await this.prismaService.comment
      .update({
        where: {
          id: commentId,
          createdBy: this.cls.get('user.id'),
        },
        data: {
          deletedTime: new Date().toISOString(),
        },
      })
      .catch(() => {
        throw new ForbiddenException('You have no permission to delete this comment');
      });
  }

  async deleteCommentReaction(commentId: string, emojiRo: { emoji: string }) {
    const commentRaw = await this.getCommentReactionById(commentId);
    const { emoji } = emojiRo;
    let data: ICommentVo['reaction'] = [];

    if (commentRaw && commentRaw.reaction) {
      const emojis = JSON.parse(commentRaw.reaction) as ICommentVo['reaction'];
      const index = emojis.findIndex((item) => item.reaction === emoji);
      if (index > -1) {
        const newUser = emojis[index].user.filter((item) => item !== this.cls.get('user.id'));
        if (newUser.length === 0) {
          emojis.splice(index, 1);
        } else {
          emojis.splice(index, 1, {
            reaction: emoji,
            user: newUser,
          });
        }
        data = [...emojis];
      }
    }

    await this.prismaService.comment
      .update({
        where: {
          id: commentId,
        },
        data: {
          reaction: data.length ? JSON.stringify(data) : null,
        },
      })
      .catch((e) => {
        throw new BadGatewayException(e);
      });
  }

  async createCommentReaction(commentId: string, emojiRo: { emoji: string }) {
    const commentRaw = await this.getCommentReactionById(commentId);
    const { emoji } = emojiRo;
    let data: ICommentVo['reaction'];

    if (commentRaw && commentRaw.reaction) {
      const emojis = JSON.parse(commentRaw.reaction) as ICommentVo['reaction'];
      const index = emojis.findIndex((item) => item.reaction === emoji);
      if (index > -1) {
        emojis.splice(index, 1, {
          reaction: emoji,
          user: uniq([...emojis[index].user, this.cls.get('user.id')]),
        });
      } else {
        emojis.push({
          reaction: emoji,
          user: [this.cls.get('user.id')],
        });
      }
      data = [...emojis];
    } else {
      data = [
        {
          reaction: emoji,
          user: [this.cls.get('user.id')],
        },
      ];
    }

    await this.prismaService.comment
      .update({
        where: {
          id: commentId,
        },
        data: {
          reaction: JSON.stringify(data),
          lastModifiedTime: commentRaw?.lastModifiedTime,
        },
      })
      .catch((e) => {
        throw new BadGatewayException(e);
      });
  }

  async getNotifyDetail(tableId: string, recordId: string) {
    return await this.prismaService.commentNotify
      .findFirstOrThrow({
        where: {
          tableId,
          recordId,
        },
      })
      .catch(() => {
        return null;
      });
  }

  async notifyComment(tableId: string, recordId: string) {
    await this.prismaService.commentNotify.create({
      data: {
        tableId,
        recordId,
        createdBy: this.cls.get('user.id'),
      },
    });
  }

  async unNotifyComment(tableId: string, recordId: string) {
    await this.prismaService.commentNotify.delete({
      where: {
        // eslint-disable-next-line
        tableId_recordId: {
          tableId,
          recordId,
        },
      },
    });
  }

  private async getCommentReactionById(commentId: string) {
    return await this.prismaService.comment.findFirst({
      where: {
        id: commentId,
      },
      select: {
        reaction: true,
        lastModifiedTime: true,
      },
    });
  }
}
