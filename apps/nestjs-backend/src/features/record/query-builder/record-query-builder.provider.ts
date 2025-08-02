import { Inject } from '@nestjs/common';
import { RECORD_QUERY_BUILDER_SYMBOL } from './record-query-builder.symbol';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const InjectRecordQueryBuilder = () => Inject(RECORD_QUERY_BUILDER_SYMBOL);
