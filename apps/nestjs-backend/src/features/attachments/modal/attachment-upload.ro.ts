import { ApiPropertyOptional } from '@nestjs/swagger';

export class AttachmentUploadRo {
  @ApiPropertyOptional({
    type: String,
    example: 'xxxxxxxxxxx',
    description: 'Token for the uploaded file',
  })
  token!: string;

  @ApiPropertyOptional({
    type: Number,
    example: '1024',
    description: 'File size in bytes',
  })
  size!: number;

  @ApiPropertyOptional({
    type: String,
    example: 'video/mp4',
    description: 'MIME type of the uploaded file',
  })
  mimetype!: string;

  @ApiPropertyOptional({
    type: String,
    example: '/attachments/file.mp4',
    description: 'URL of the uploaded file',
  })
  path!: string;
}
