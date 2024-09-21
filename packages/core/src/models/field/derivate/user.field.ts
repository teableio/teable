import { z } from 'zod';
import type { FieldType } from '../constant';
import type { IUserCellValue } from './abstract/user.field.abstract';
import { UserAbstractCore } from './abstract/user.field.abstract';

interface IUser {
  id: string;
  name: string;
  email: string;
}

interface IContext {
  userSets?: IUser[];
}

const userIdSchema = z
  .string()
  .startsWith('usr')
  .or(z.enum(['me']));

export const userFieldOptionsSchema = z.object({
  isMultiple: z.boolean().optional().openapi({
    description: 'Allow adding multiple users',
  }),
  shouldNotify: z.boolean().optional().openapi({
    description: 'Notify users when their name is added to a cell',
  }),
  defaultValue: z.union([userIdSchema, z.array(userIdSchema)]).optional(),
});

export type IUserFieldOptions = z.infer<typeof userFieldOptionsSchema>;

export const defaultUserFieldOptions: IUserFieldOptions = {
  isMultiple: false,
  shouldNotify: true,
};

export class UserFieldCore extends UserAbstractCore {
  type!: FieldType.User;
  options!: IUserFieldOptions;

  static defaultOptions() {
    return defaultUserFieldOptions;
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
      const cellValue = value.split(',').map((s) => s.trim());

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
      const { id, name, email } = user;
      if (value === id || value === name || value === email) {
        if (foundUser) {
          // Multiple collaborators are matched and the cell is cleared
          return null;
        }
        foundUser = user;
      }
    }
    return foundUser ? { id: foundUser.id, title: foundUser.name, email: foundUser.email } : null;
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
}
