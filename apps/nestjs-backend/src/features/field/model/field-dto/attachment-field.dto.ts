import type { IAttachmentItem } from '@teable-group/core';
import { AttachmentFieldCore, generateAttachmentId } from '@teable-group/core';
import type { IFieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements IFieldBase {
  static getTokenAndNameByString(value: string): { token: string; name: string } | undefined {
    const obj = value.match(/(.+?)\s\(([^)]+)/);
    const url = obj?.[2];
    const paths = url?.split('/') || [];
    return { name: obj?.[1] || '', token: paths[paths.length - 1] };
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
    const tokensAndNames = value.split(',').map(AttachmentFieldDto.getTokenAndNameByString);
    return tokensAndNames
      .map((tokenAndName) => {
        const { token, name } = tokenAndName || {};
        if (!token) {
          return;
        }
        const attachment = attachments.find((attachment) => attachment.token === token);
        if (!attachment) {
          return;
        }
        return {
          ...attachment,
          name,
          id: generateAttachmentId(),
        };
      })
      .filter(Boolean) as IAttachmentItem[];
  }
}
