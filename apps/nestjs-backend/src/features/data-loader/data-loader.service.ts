import { Injectable } from '@nestjs/common';
import { FieldLoaderService } from './resource/field-loader.service';
// import { TableLoaderService } from './resource/table-loader.service';
// import { ViewLoaderService } from './resource/view-loader.service';

@Injectable()
export class DataLoaderService {
  constructor(
    readonly field: FieldLoaderService
    // readonly table: TableLoaderService,
    // readonly view: ViewLoaderService
  ) {}
}
