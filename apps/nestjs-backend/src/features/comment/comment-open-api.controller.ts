import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import type { ICommentItem as ICommentVo } from '@teable/openapi';
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

  @Get('/list')
  @Permissions('view|read')
  async getComment(
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
}
