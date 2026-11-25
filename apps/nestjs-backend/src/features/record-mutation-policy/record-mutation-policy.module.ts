import { Module } from '@nestjs/common';
import { RecordMutationPolicyService } from './record-mutation-policy.service';

@Module({
  providers: [RecordMutationPolicyService],
  exports: [RecordMutationPolicyService],
})
export class RecordMutationPolicyModule {}
