import { ServiceUnavailableException } from '@nestjs/common';
import { PUBLIC_ROW_ADMISSION_BUSY_CODE } from '@teable/v2-contract-http';

/** Only throw before entering the admitted write callback. */
export class PublicRowAdmissionBusyException extends ServiceUnavailableException {
  readonly data = { domainCode: PUBLIC_ROW_ADMISSION_BUSY_CODE, domainTags: ['infrastructure'] };

  constructor() {
    super('Public row admission is busy. Please try again shortly.');
  }
}
