import { ApiProperty } from '@nestjs/swagger';

export class AttachmentSignatureRo {
  @ApiProperty({
    type: String,
    example: 'https://example.com/attachment/upload',
    description: 'Upload url',
  })
  url!: string;

  @ApiProperty({
    type: String,
    example: 'xxxxxxxx',
    description: 'Secret key',
  })
  secret!: string;
}
