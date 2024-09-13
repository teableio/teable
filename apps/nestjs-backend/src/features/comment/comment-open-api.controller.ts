import { Controller, Get, Post, Body, Param, Patch, Delete, Query } from '@nestjs/common';
import type { ICommentVo, IGetCommentListVo } from '@teable/openapi';
import {
  createCommentRoSchema,
  ICreateCommentRo,
  IUpdateCommentRo,
  updateCommentRoSchema,
  updateCommentReactionRoSchema,
  IUpdateCommentReactionRo,
  getCommentListQueryRoSchema,
  IGetCommentListQueryRo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { CommentOpenApiService } from './comment-open-api.service';

@Controller('api/comment/:tableId/:recordId')
@TokenAccess()
export class CommentOpenApiController {
  constructor(
    private readonly commentOpenApiService: CommentOpenApiService,
    private readonly attachmentsStorageService: AttachmentsStorageService
  ) {}

  @Get('/attachment/:path')
  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Permissions('record|read')
  async getAttachmentPresignedUrl(@Param('path') path: string) {
    const [bucket, token] = path.split('/');
    return this.attachmentsStorageService.getPreviewUrlByPath(bucket, path, token);
  }

  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Get('/notify')
  @Permissions('record|read')
  async getNotifyDetail(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.getNotifyDetail(tableId, recordId);
  }

  @Post('/notify')
  @Permissions('record|read')
  async notifyComment(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.notifyComment(tableId, recordId);
  }

  @Delete('/notify')
  @Permissions('record|read')
  async unNotifyComment(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.unNotifyComment(tableId, recordId);
  }

  @Get('/list')
  @Permissions('record|read')
  async getCommentList(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getCommentListQueryRoSchema))
    getCommentListQueryRo: IGetCommentListQueryRo
  ): Promise<IGetCommentListVo> {
    return this.commentOpenApiService.getCommentList(tableId, recordId, getCommentListQueryRo);
  }

  @Post('/create')
  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Permissions('record|comment')
  async createComment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(createCommentRoSchema)) createCommentRo: ICreateCommentRo
  ) {
    return this.commentOpenApiService.createComment(tableId, recordId, createCommentRo);
  }

  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Get('/:commentId')
  @Permissions('record|read')
  async getCommentDetail(@Param('commentId') commentId: string): Promise<ICommentVo> {
    return this.commentOpenApiService.getCommentDetail(commentId);
  }

  @Patch('/:commentId')
  @Permissions('record|comment')
  async updateComment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(updateCommentRoSchema)) updateCommentRo: IUpdateCommentRo
  ) {
    return this.commentOpenApiService.updateComment(tableId, recordId, commentId, updateCommentRo);
  }

  @Delete('/:commentId')
  @Permissions('record|read')
  async deleteComment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string
  ) {
    return this.commentOpenApiService.deleteComment(tableId, recordId, commentId);
  }

  @Delete('/:commentId/reaction')
  @Permissions('record|comment')
  async deleteCommentReaction(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(updateCommentReactionRoSchema)) reactionRo: IUpdateCommentReactionRo
  ) {
    return this.commentOpenApiService.deleteCommentReaction(
      tableId,
      recordId,
      commentId,
      reactionRo
    );
  }

  @Patch('/:commentId/reaction')
  @Permissions('record|comment')
  async updateCommentReaction(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(updateCommentReactionRoSchema)) reactionRo: IUpdateCommentReactionRo
  ) {
    return this.commentOpenApiService.createCommentReaction(
      tableId,
      recordId,
      commentId,
      reactionRo
    );
  }
}
