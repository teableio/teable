import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import type { ICommentVo } from '@teable/openapi';
import {
  createCommentRoSchema,
  ICreateCommentRo,
  IUpdateCommentRo,
  updateCommentRoSchema,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { CommentOpenApiService } from './comment-open-api.service';

@Controller('api/comment/:tableId/:recordId')
@TokenAccess()
export class CommentOpenApiController {
  constructor(private readonly commentOpenApiService: CommentOpenApiService) {}

  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Get('/notify')
  async getNotifyDetail(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.getNotifyDetail(tableId, recordId);
  }

  @Post('/notify')
  async notifyComment(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.notifyComment(tableId, recordId);
  }

  @Delete('/notify')
  async unNotifyComment(@Param('tableId') tableId: string, @Param('recordId') recordId: string) {
    return this.commentOpenApiService.unNotifyComment(tableId, recordId);
  }

  @Get('/list')
  @Permissions('view|read')
  async getCommentList(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string
  ): Promise<ICommentVo[]> {
    return this.commentOpenApiService.getCommentList(tableId, recordId);
  }

  @Post('/create')
  async createComment(
    @Param('tableId') tableId: string,
    @Param('recordId') recordId: string,
    @Body(new ZodValidationPipe(createCommentRoSchema)) createCommentRo: ICreateCommentRo
  ) {
    return this.commentOpenApiService.createComment(tableId, recordId, createCommentRo);
  }

  // eslint-disable-next-line sonarjs/no-duplicate-string
  @Get('/:commentId')
  async getCommentDetail(@Param('commentId') commentId: string): Promise<ICommentVo> {
    return this.commentOpenApiService.getCommentDetail(commentId);
  }

  @Patch('/:commentId')
  async updateComment(
    @Param('commentId') commentId: string,
    @Body(new ZodValidationPipe(updateCommentRoSchema)) updateCommentRo: IUpdateCommentRo
  ) {
    return this.commentOpenApiService.updateComment(commentId, updateCommentRo);
  }

  @Delete('/:commentId')
  async deleteComment(@Param('commentId') commentId: string) {
    return this.commentOpenApiService.deleteComment(commentId);
  }

  @Delete('/:commentId/reaction')
  async deleteCommentReaction(
    @Param('commentId') commentId: string,
    @Body() emojiRo: { emoji: string }
  ) {
    return this.commentOpenApiService.deleteCommentReaction(commentId, emojiRo);
  }

  @Patch('/:commentId/reaction')
  async updateCommentEmoji(
    @Param('commentId') commentId: string,
    @Body() emojiRo: { emoji: string }
  ) {
    return this.commentOpenApiService.createCommentReaction(commentId, emojiRo);
  }
}
