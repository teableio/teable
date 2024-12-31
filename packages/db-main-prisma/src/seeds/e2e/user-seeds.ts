/* eslint-disable @typescript-eslint/no-explicit-any */
import bcrypt from 'bcrypt';
import type { Prisma } from '../../';
import { AbstractSeed } from '../seed.abstract';

export const CREATE_USER_NUM = 1;

const generatePassword = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);
  return { salt, password: hashPassword };
};

const createUser = (
  baseId: string,
  baseName: string,
  pas: any,
  index?: number
): Prisma.UserCreateInput => {
  const id = index === undefined ? baseId : `${baseId}_${index}`;
  return {
    id,
    name: index === undefined ? baseName : `${baseName}_${index}`,
    email: index === undefined ? `${baseName}@e2e.com` : `${baseName}_${index}@e2e.com`,
    salt: pas.salt,
    password: pas.password,
    notifyMeta: JSON.stringify({ email: true }),
    avatar: `avatar/${id}`,
    isAdmin: index === undefined,
  };
};

export const generateUser = async (max: number): Promise<Prisma.UserCreateInput[]> => {
  const userId = 'usrTestUserId';
  const userName = 'test';
  const pas = await generatePassword('12345678');

  return Array.from({ length: max + 1 }, (_, i) =>
    createUser(userId, userName, pas, i === 0 ? undefined : i)
  );
};

export class UserSeeds extends AbstractSeed {
  execute = async (): Promise<void> => {
    const userSets = await generateUser(CREATE_USER_NUM);

    for (const u of userSets) {
      const { id, name, email, ...userNonUnique } = u;
      const user = await this.prisma.user.upsert({
        where: { email },
        update: userNonUnique,
        create: u,
      });
      this.log('UPSERT', `User ${user.id} - ${user.email} - ${user.password}`);
    }
  };
}
