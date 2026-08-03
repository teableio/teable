import type { IAttachmentCellValue, IAttachmentItem } from '@teable/core';
import { AttachmentFieldCore, generateAttachmentId } from '@teable/core';
import { omit } from 'lodash';
import type { FieldBase } from '../field-base';

export class AttachmentFieldDto extends AttachmentFieldCore implements FieldBase {
  get isStructuredCellValue() {
    return false;
  }

  static getTokenAndNameByString(value: string): { token: string; name: string } | undefined {
    const openParenIndex = value.lastIndexOf('(');

    if (openParenIndex === -1) {
      return;
    }
    const name = value.slice(0, openParenIndex).trim();
    const token = value.slice(openParenIndex + 1, -1).trim();
    return { name, token };
  }

  convertCellValue2DBValue(value: unknown): unknown {
    return (
      value &&
      JSON.stringify(
        (value as IAttachmentCellValue).map((item) =>
          omit(item, ['presignedUrl', 'smThumbnailUrl', 'lgThumbnailUrl'])
        )
      )
    );
  }

  convertDBValue2CellValue(value: unknown): unknown {
    return value == null || typeof value === 'object' ? value : JSON.parse(value as string);
  }

  override convertStringToCellValue(
    value: string,
    attachments?: Omit<IAttachmentItem, 'id' | 'name'>[]
  ) {
    // value is ddd.svg (token)
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
