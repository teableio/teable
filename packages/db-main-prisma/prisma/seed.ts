import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// const userData: Prisma.UserCreateInput[] = [
//   {
//     firstName: 'tea',
//     lastName: 'artist',
//     nickname: 'tea artist',
//     email: 'artist@teable.io',
//   },
// ];

async function main() {
  // console.log(`Start seeding ...`);
  // users and posts
  // for (const u of userData) {
  //   const user = await prisma.user.upsert({
  //     where: { email: u.email },
  //     update: {},
  //     create: u,
  //   });
  //   console.log(`Created or updated user with id: ${user.id}`);
  // }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
