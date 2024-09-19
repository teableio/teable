import {
  Injectable,
  Logger,
  ForbiddenException,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { generateCommentId, getCommentChannel, getTableCommentChannel } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ICreateCommentRo,
  ICommentVo,
  IUpdateCommentRo,
  IGetCommentListQueryRo,
  ICommentContent,
  IGetRecordsRo,
  IParagraphCommentContent,
} from '@teable/openapi';
import { CommentNodeType, CommentPatchType } from '@teable/openapi';
import { uniq, omit } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { NotificationService } from '../notification/notification.service';
import { RecordService } from '../record/record.service';

@Injectable()
export class CommentOpenApiService {
  private logger = new Logger(CommentOpenApiService.name);
  constructor(
    private readonly notificationService: NotificationService,
    private readonly recordService: RecordService,
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly shareDbService: ShareDbService
  ) {}

  async getCommentDetail(commentId: string) {
    const rawComment = await this.prismaService.comment.findFirst({
      where: {
        id: commentId,
        deletedTime: null,
      },
      select: {
        id: true,
        content: true,
        createdBy: true,
        createdTime: true,
        lastModifiedTime: true,
        deletedTime: true,
        quoteId: true,
        reaction: true,
      },
    });

    if (!rawComment) {
      return null;
    }

    return {
      ...rawComment,
      reaction: rawComment.reaction ? JSON.parse(rawComment?.reaction) : null,
      content: rawComment?.content ? JSON.parse(rawComment?.content) : null,
    } as ICommentVo;
  }

  async getCommentList(
    tableId: string,
    recordId: string,
    getCommentListQuery: IGetCommentListQueryRo
  ) {
    const { cursor, take = 20, direction = 'forward', includeCursor = true } = getCommentListQuery;

    if (take > 1000) {
      throw new BadRequestException(`${take} exceed the max count comment list count 1000`);
    }

    const takeWithDirection = direction === 'forward' ? -(take + 1) : take + 1;

    const rawComments = await this.prismaService.comment.findMany({
      where: {
        recordId,
        tableId,
        deletedTime: null,
      },
      orderBy: [{ createdTime: 'asc' }],
      take: takeWithDirection,
      skip: cursor ? (includeCursor ? 0 : 1) : 0,
      cursor: cursor ? { id: cursor } : undefined,
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

    const hasNextPage = rawComments.length > take;

    const nextCursor = hasNextPage
      ? direction === 'forward'
        ? rawComments.shift()?.id
        : rawComments.pop()?.id
      : null;

    const parsedComments = rawComments
      .sort((a, b) => a.createdTime.getTime() - b.createdTime.getTime())
      .map(
        (comment) =>
          ({
            ...comment,
            content: comment.content ? JSON.parse(comment.content) : null,
            reaction: comment.reaction ? JSON.parse(comment.reaction) : null,
          }) as ICommentVo
      );

    return {
      comments: parsedComments,
      nextCursor,
    };
  }

  async createComment(tableId: string, recordId: string, createCommentRo: ICreateCommentRo) {
    const id = generateCommentId();
    const result = await this.prismaService.comment.create({
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

    await this.sendCommentNotify(tableId, recordId, id, {
      content: result.content,
      quoteId: result.quoteId,
    });

    this.sendCommentPatch(tableId, recordId, CommentPatchType.CreateComment, result);
    this.sendTableCommentPatch(tableId, recordId, CommentPatchType.CreateComment);

    return {
      ...result,
      content: result.content ? JSON.parse(result.content) : null,
    };
  }

  async updateComment(
    tableId: string,
    recordId: string,
    commentId: string,
    updateCommentRo: IUpdateCommentRo
  ) {
    const result = await this.prismaService.comment
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

    this.sendCommentPatch(tableId, recordId, CommentPatchType.UpdateComment, result);
    await this.sendCommentNotify(tableId, recordId, commentId, {
      quoteId: result.quoteId,
      content: result.content,
    });
  }

  async deleteComment(tableId: string, recordId: string, commentId: string) {
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

    this.sendCommentPatch(tableId, recordId, CommentPatchType.CreateReaction, { id: commentId });
    this.sendTableCommentPatch(tableId, recordId, CommentPatchType.DeleteComment);
  }

  async deleteCommentReaction(
    tableId: string,
    recordId: string,
    commentId: string,
    reactionRo: { reaction: string }
  ) {
    const commentRaw = await this.getCommentReactionById(commentId);
    const { reaction } = reactionRo;
    let data: ICommentVo['reaction'] = [];

    if (commentRaw && commentRaw.reaction) {
      const emojis = JSON.parse(commentRaw.reaction) as NonNullable<ICommentVo['reaction']>;
      const index = emojis.findIndex((item) => item.reaction === reaction);
      if (index > -1) {
        const newUser = emojis[index].user.filter((item) => item !== this.cls.get('user.id'));
        if (newUser.length === 0) {
          emojis.splice(index, 1);
        } else {
          emojis.splice(index, 1, {
            reaction,
            user: newUser,
          });
        }
        data = [...emojis];
      }
    }

    const result = await this.prismaService.comment
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

    this.sendCommentPatch(tableId, recordId, CommentPatchType.DeleteReaction, result);
  }

  async createCommentReaction(
    tableId: string,
    recordId: string,
    commentId: string,
    reactionRo: { reaction: string }
  ) {
    const commentRaw = await this.getCommentReactionById(commentId);
    const { reaction } = reactionRo;
    let data: ICommentVo['reaction'];

    if (commentRaw && commentRaw.reaction) {
      const emojis = JSON.parse(commentRaw.reaction) as NonNullable<ICommentVo['reaction']>;
      const index = emojis.findIndex((item) => item.reaction === reaction);
      if (index > -1) {
        emojis.splice(index, 1, {
          reaction,
          user: uniq([...emojis[index].user, this.cls.get('user.id')]),
        });
      } else {
        emojis.push({
          reaction,
          user: [this.cls.get('user.id')],
        });
      }
      data = [...emojis];
    } else {
      data = [
        {
          reaction,
          user: [this.cls.get('user.id')],
        },
      ];
    }

    const result = await this.prismaService.comment
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

    await this.sendCommentPatch(tableId, recordId, CommentPatchType.CreateReaction, result);
    await this.sendCommentNotify(tableId, recordId, commentId, {
      quoteId: result.quoteId,
      content: result.content,
    });
  }

  async getSubscribeDetail(tableId: string, recordId: string) {
    return await this.prismaService.commentSubscription
      .findUniqueOrThrow({
        where: {
          // eslint-disable-next-line
          tableId_recordId: {
            tableId,
            recordId,
          },
        },
        select: {
          tableId: true,
          recordId: true,
          createdBy: true,
        },
      })
      .catch(() => {
        return null;
      });
  }

  async subscribeComment(tableId: string, recordId: string) {
    await this.prismaService.commentSubscription.create({
      data: {
        tableId,
        recordId,
        createdBy: this.cls.get('user.id'),
      },
    });
  }

  async unsubscribeComment(tableId: string, recordId: string) {
    await this.prismaService.commentSubscription.delete({
      where: {
        // eslint-disable-next-line
        tableId_recordId: {
          tableId,
          recordId,
        },
      },
    });
  }

  async getTableCommentCount(tableId: string, query: IGetRecordsRo) {
    const recordVo = await this.recordService.getRecords(tableId, query);
    const recordsId = recordVo.records.map((rec) => rec.id);

    const result = await this.prismaService.comment.groupBy({
      by: ['recordId'],
      where: {
        recordId: {
          in: recordsId,
        },
        deletedTime: null,
      },
      _count: {
        ['recordId']: true,
      },
    });

    return result.map(({ _count: { recordId: count }, recordId }) => ({
      recordId,
      count,
    }));
  }

  async getRecordCommentCount(tableId: string, recordId: string) {
    const result = await this.prismaService.comment.count({
      where: {
        tableId,
        recordId,
        deletedTime: null,
      },
    });

    return {
      count: result,
    };
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

  private async sendCommentNotify(
    tableId: string,
    recordId: string,
    commentId: string,
    notifyVo: { quoteId: string | null; content: string | null }
  ) {
    const { quoteId, content } = notifyVo;
    const { id: fromUserId, name: fromUserName } = this.cls.get('user');
    const relativeUsers: string[] = [];

    if (quoteId) {
      const { createdBy: quoteCommentCreator } =
        (await this.prismaService.comment.findUnique({
          where: {
            id: quoteId,
          },
          select: {
            createdBy: true,
          },
        })) || {};
      quoteCommentCreator && relativeUsers.push(quoteCommentCreator);
    }

    const mentionUsers = this.getMentionUserByContent(content);

    if (mentionUsers.length) {
      relativeUsers.push(...mentionUsers);
    }

    const { baseId, name: tableName } =
      (await this.prismaService.tableMeta.findFirst({
        where: {
          id: tableId,
        },
        select: {
          baseId: true,
          name: true,
        },
      })) || {};

    const { id: fieldId } =
      (await this.prismaService.field.findFirst({
        where: {
          tableId,
          isPrimary: true,
        },
        select: {
          id: true,
        },
      })) || {};

    if (!baseId || !fieldId) {
      return;
    }

    const { name: baseName } =
      (await this.prismaService.base.findFirst({
        where: {
          id: baseId,
        },
        select: {
          name: true,
        },
      })) || {};

    const recordName = await this.recordService.getCellValue(tableId, recordId, fieldId);

    const notifyUsers = await this.prismaService.commentSubscription.findMany({
      where: {
        tableId,
        recordId,
      },
      select: {
        createdBy: true,
      },
    });

    const subscribeUsersIds = Array.from(
      new Set([...notifyUsers.map(({ createdBy }) => createdBy), ...relativeUsers])
    ).filter((userId) => userId !== fromUserId);

    const message = `${fromUserName} made a commented on ${recordName ? recordName : 'a record'} in ${tableName} ${baseName ? `in ${baseName}` : ''}`;

    subscribeUsersIds.forEach((userId) => {
      this.notificationService.sendCommentNotify({
        baseId,
        tableId,
        recordId,
        commentId,
        toUserId: userId,
        message,
        fromUserId,
      });
    });
  }

  private getMentionUserByContent(commentContentRaw: string | null) {
    if (!commentContentRaw) {
      return [];
    }

    const commentContent = JSON.parse(commentContentRaw) as ICommentContent;

    return commentContent
      .filter(
        // so strange that infer automatically error
        (comment): comment is IParagraphCommentContent => comment.type === CommentNodeType.Paragraph
      )
      .flatMap((paragraphNode) => paragraphNode.children)
      .filter((lineNode) => lineNode.type === CommentNodeType.Mention)
      .map((mentionNode) => mentionNode.value) as string[];
  }

  private createCommentPresence(tableId: string, recordId: string) {
    const channel = getCommentChannel(tableId, recordId);
    const presence = this.shareDbService.connect().getPresence(channel);
    return presence.create(channel);
  }

  private sendCommentPatch(
    tableId: string,
    recordId: string,
    type: CommentPatchType,
    data: Record<string, unknown>
  ) {
    const localPresence = this.createCommentPresence(tableId, recordId);

    let finalData = omit(data, ['tableId', 'recordId']);

    if (
      [
        CommentPatchType.CreateComment,
        CommentPatchType.CreateReaction,
        CommentPatchType.UpdateComment,
        CommentPatchType.DeleteReaction,
      ].includes(type)
    ) {
      const { content, reaction } = finalData;
      finalData = {
        ...finalData,
        content: content ? JSON.parse(content as string) : content,
        reaction: reaction ? JSON.parse(reaction as string) : reaction,
      };
    }

    localPresence.submit(
      {
        type: type,
        data: finalData,
      },
      (error) => {
        error && this.logger.error('Comment patch presence error: ', error);
      }
    );
  }

  private sendTableCommentPatch(tableId: string, recordId: string, type: CommentPatchType) {
    const channel = getTableCommentChannel(tableId);
    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(channel);

    localPresence.submit(
      {
        type,
        data: {
          recordId,
        },
      },
      (error) => {
        error && this.logger.error('Comment patch presence error: ', error);
      }
    );
  }
}
