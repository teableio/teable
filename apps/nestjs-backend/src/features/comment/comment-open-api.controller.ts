import { Controller, Get, Post, Body, Param, Patch, Delete, Query } from '@nestjs/common';
import type { ICommentVo, IGetCommentListVo, ICommentSubscribeVo } from '@teable/openapi';
import {
  getRecordsRoSchema,
  createCommentRoSchema,
  ICreateCommentRo,
  IUpdateCommentRo,
  updateCommentRoSchema,
  updateCommentReactionRoSchema,
  IUpdateCommentReactionRo,
  getCommentListQueryRoSchema,
  IGetCommentListQueryRo,
  IGetRecordsRo,
  UploadType,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TqlPipe } from '../record/open-api/tql.pipe';
import { CommentOpenApiService } from './comment-open-api.service';

@Controller('api/comment/:tableId')
export class CommentOpenApiController {
  constructor(
    private readonly commentOpenApiService: CommentOpenApiService,
    private readonly attachmentsStorageService: AttachmentsStorageService
  ) {}

  @Get('/:recordId/count')
  @Permissions('view|read')
  async getRecordCommentCount(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ) {
    return this.commentOpenApiService.getRecordCommentCount(tableId, recordId);
  }

  @Get('/count')
  @Permissions('view|read')
  async getTableCommentCount(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(getRecordsRoSchema), TqlPipe) query: IGetRecordsRo
  ) {
    return this.commentOpenApiService.getTableCommentCount(tableId, query);
  }

  @Get('/:recordId/attachment/:path')
  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Permissions('record|read')
  async getAttachmentPresignedUrl(@Param('path') path: string) {
    const [, token] = path.split('/');
    const bucket = StorageAdapter.getBucket(UploadType.Comment);
    return this.attachmentsStorageService.getPreviewUrlByPath(bucket, path, token);
  }

  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Get('/:recordId/subscribe')
  @Permissions('record|read')
  async getSubscribeDetail(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ): Promise<ICommentSubscribeVo | null> {
    return this.commentOpenApiService.getSubscribeDetail(tableId, recordId);
  }

  @Post('/:recordId/subscribe')
  @Permissions('record|read')
  async subscribeComment(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.subscribeComment(tableId, recordId);
  }

  @Delete('/:recordId/subscribe')
  @Permissions('record|read')
  async unsubscribeComment(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.unsubscribeComment(tableId, recordId);
  }

  @Get('/:recordId/list')
  @Permissions('record|read')
  async getCommentList(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Query(new ZodValidationPipe(getCommentListQueryRoSchema))
    getCommentListQueryRo: IGetCommentListQueryRo
  ): Promise<IGetCommentListVo> {
    return this.commentOpenApiService.getCommentList(tableId, recordId, getCommentListQueryRo);
  }

  @Post('/:recordId/create')
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
  @Get('/:recordId/:commentId')
  @Permissions('record|read')
  async getCommentDetail(@Param('commentId') commentId: string): Promise<ICommentVo | null> {
    return this.commentOpenApiService.getCommentDetail(commentId);
  }

  @Patch('/:recordId/:commentId')
  @Permissions('record|comment')
  async updateComment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(updateCommentRoSchema)) updateCommentRo: IUpdateCommentRo
  ) {
    return this.commentOpenApiService.updateComment(tableId, recordId, commentId, updateCommentRo);
  }

  @Delete('/:recordId/:commentId')
  @Permissions('record|read')
  async deleteComment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Param('commentId') commentId: string
  ) {
    return this.commentOpenApiService.deleteComment(tableId, recordId, commentId);
  }

  @Delete('/:recordId/:commentId/reaction')
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

  @Patch('/:recordId/:commentId/reaction')
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
