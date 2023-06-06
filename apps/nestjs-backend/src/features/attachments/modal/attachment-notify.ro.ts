import { ApiProperty } from '@nestjs/swagger';

export class AttachmentNotifyRo {
  @ApiProperty({
    type: String,
    example: 'xxxxxxxxxxx',
    description: 'Token for the uploaded file',
  })
  token!: string;

  @ApiProperty({
    type: Number,
    example: 1024,
    description: 'File size in bytes',
  })
  size!: number;

  @ApiProperty({
    type: String,
    example: 'video/mp4',
    description: 'MIME type of the uploaded file',
  })
  mimetype!: string;

  @ApiProperty({
    type: String,
    example: '/attachments',
    description: 'URL of the uploaded file',
  })
  path!: string;

  @ApiProperty({
    type: Number,
    example: 100,
    description: 'Image width of the uploaded file',
  })
  width!: number | null;

  @ApiProperty({
    type: Number,
    example: 100,
    description: 'Image height of the uploaded file',
  })
  height!: number | null;
}
