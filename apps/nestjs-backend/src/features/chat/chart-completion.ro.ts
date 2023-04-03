import { ApiProperty } from '@nestjs/swagger';

export class CompletionRo {
  @ApiProperty({
    description: 'The prompt message.',
    example: 'List table',
  })
  message!: string;
}
