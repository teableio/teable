import type { IAttachmentCellValue, IAttachmentItem } from '@teable-group/core';
import { AttachmentFieldCore, generateAttachmentId } from '@teable-group/core';
import { baseConfig } from '../../../../configs/base.config';
import { getFullStorageUrl } from '../../../../utils/full-storage-url';
import type { IFieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements IFieldBase {
  static getTokenAndNameByString(value: string): { token: string; name: string } | undefined {
    const obj = value.match(/(.+?)\s\(([^)]+)/);
    const url = obj?.[2];
    const paths = url?.split('/') || [];
    return { name: obj?.[1] || '', token: paths[paths.length - 1] };
  }

  convertCellValue2DBValue(value: unknown): unknown {
    const storagePrefix = baseConfig().storagePrefix;

    return (
      value &&
      JSON.stringify(
        (value as IAttachmentCellValue).map((item) => ({
          ...item,
          url: item.url.split(storagePrefix)[1],
        }))
      )
    );
  }

  convertDBValue2CellValue(value: unknown): unknown {
    const cellValue =
      value == null || typeof value === 'object' ? value : JSON.parse(value as string);
    return cellValue
      ? cellValue.map((item: IAttachmentItem) => ({
          ...item,
          url: getFullStorageUrl(item.url),
        }))
      : null;
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
