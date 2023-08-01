import type { IFieldRo, IAttachmentItem } from '@teable-group/core';
import {
  AttachmentFieldCore,
  CellValueType,
  DbFieldType,
  generateAttachmentId,
} from '@teable-group/core';
import { plainToInstance } from 'class-transformer';
import type { IFieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements IFieldBase {
  static factory(fieldRo: IFieldRo) {
    const isLookup = fieldRo.isLookup;

    return plainToInstance(AttachmentFieldDto, {
      ...fieldRo,
      name: fieldRo.name ?? 'Attachments',
      options: fieldRo.options ?? this.defaultOptions(),
      isComputed: isLookup,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Json,
    } as AttachmentFieldDto);
  }

  static getTokenByString(value: string): string | undefined {
    const url = value.match(/\((.*?)\)/)?.[1];
    const paths = url?.split('/') || [];
    return paths[paths.length - 1];
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: string): unknown {
    return value && JSON.parse(value);
  }

  override convertStringToCellValue(
    value: string,
    attachments?: Omit<IAttachmentItem, 'id' | 'name'>[]
  ) {
    // value is ddd.svg (https://xxx.xxx/xxx)
    if (!attachments?.length || !value) {
      return null;
    }
    const tokens = value.split(',').map(AttachmentFieldDto.getTokenByString);
    return tokens
      .map((token) => {
        const attachment = attachments.find((attachment) => attachment.token === token);
        if (!attachment) {
          return;
        }
        return {
          ...attachment,
          name: '',
          id: generateAttachmentId(),
        };
      })
      .filter(Boolean) as IAttachmentItem[];
  }
}
