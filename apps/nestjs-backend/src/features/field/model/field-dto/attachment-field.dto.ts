import type { IAttachmentItem } from '@teable-group/core';
import { AttachmentFieldCore, generateAttachmentId } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements IFieldBase {
  static getTokenByString(value: string): string | undefined {
    const url = value.match(/\((.*?)\)/)?.[1];
    const paths = url?.split('/') || [];
    return paths[paths.length - 1];
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return value && JSON.stringify(value);
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
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
