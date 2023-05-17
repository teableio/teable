import { ApiProperty } from '@nestjs/swagger';

export class AttachmentUploadVo {
  @ApiProperty({ type: 'string', format: 'binary' })
  file!: Express.Multer.File;
}
