import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import type { CellValueType, FieldType } from '../constant';
import { FieldCore } from '../field';

interface IUser {
  id: string;
  name: string;
  email: string;
}

interface IContext {
  userSets?: IUser[];
}

export const userFieldOptionsSchema = z.object({
  isMultiple: z.boolean().openapi({
    description: 'Allow adding multiple users',
  }),
  shouldNotify: z.boolean().openapi({
    description: 'Notify users when their name is added to a cell',
  }),
});

export type IUserFieldOptions = z.infer<typeof userFieldOptionsSchema>;

export const userCellValueSchema = z.object({
  id: z.string().startsWith(IdPrefix.User),
  title: z.string(),
  avatarUrl: z.string().optional().nullable(),
});

export type IUserCellValue = z.infer<typeof userCellValueSchema>;

export const defaultUserFieldOptions: IUserFieldOptions = {
  isMultiple: false,
  shouldNotify: true,
};

export class UserFieldCore extends FieldCore {
  type!: FieldType.User;
  options!: IUserFieldOptions;
  cellValueType!: CellValueType.String;

  static defaultOptions() {
    return defaultUserFieldOptions;
  }

  item2String(value: unknown) {
    if (value == null) {
      return '';
    }

    const { title } = value as IUserCellValue;

    if (this.isMultipleCellValue && title?.includes(',')) {
      return `"${title}"`;
    }
    return title || '';
  }

  cellValue2String(cellValue?: unknown) {
    if (Array.isArray(cellValue)) {
      return cellValue.map((v) => this.item2String(v)).join(', ');
    }
    return this.item2String(cellValue);
  }

  /*
   * If the field matches the full name, or email of exactly one user, it will be converted to that user;
   * If the content of a cell does not match any of the users, or if the content is ambiguous (e.g., there are two collaborators with the same name), the cell will be cleared.
   */
  convertStringToCellValue(
    value: string,
    ctx?: IContext
  ): IUserCellValue | IUserCellValue[] | null {
    if (this.isLookup || !value) {
      return null;
    }

    if (this.isMultipleCellValue) {
      const cellValue = value.split(/[\n\r,]\s?(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => {
        return item.includes(',') ? item.slice(1, -1) : item;
      });

      return cellValue
        .map((v) => {
          return this.matchUser(v, ctx?.userSets);
        })
        .filter(Boolean) as IUserCellValue[];
    }
    return this.matchUser(value, ctx?.userSets);
  }

  private matchUser(value: string, userSets: IUser[] = []) {
    let foundUser: IUser | null = null;
    for (const user of userSets) {
      const { name, email } = user;
      if (value === name || value === email) {
        if (foundUser) {
          // Multiple collaborators are matched and the cell is cleared
          return null;
        }
        foundUser = user;
      }
    }
    return foundUser ? { id: foundUser.id, title: foundUser.name } : null;
  }

  repair(value: unknown) {
    if (this.isLookup) {
      return null;
    }

    if (this.validateCellValue(value).success) {
      return value;
    }
    return null;
  }

  validateOptions() {
    return userFieldOptionsSchema.safeParse(this.options);
  }

  validateCellValue(cellValue: unknown) {
    if (this.isMultipleCellValue) {
      return z.array(userCellValueSchema).nonempty().nullable().safeParse(cellValue);
    }
    return userCellValueSchema.nullable().safeParse(cellValue);
  }
}
