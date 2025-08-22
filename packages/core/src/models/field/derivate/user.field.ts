import type { FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import type { IUserCellValue } from './abstract/user.field.abstract';
import { UserAbstractCore } from './abstract/user.field.abstract';
import { userFieldOptionsSchema, type IUserFieldOptions } from './user-option.schema';

interface IUser {
  id: string;
  name: string;
  email: string;
}

interface IContext {
  userSets?: IUser[];
}

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

  override get isStructuredCellValue() {
    return true;
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
    const cellValue = value.split(',').map((s) => s.trim());
    if (this.isMultipleCellValue) {
      const cvArray = cellValue
        .map((v) => {
          return this.matchUser(v, ctx?.userSets);
        })
        .filter(Boolean) as IUserCellValue[];
      return cvArray.length ? cvArray : null;
    }
    return this.matchUser(cellValue[0], ctx?.userSets);
  }

  private matchUser(value: string, userSets: IUser[] = []) {
    const foundUser = userSets.find((user) => {
      const { id, name, email } = user;
      return value === id || value === name || value === email;
    });
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

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitUserField(this);
  }
}
