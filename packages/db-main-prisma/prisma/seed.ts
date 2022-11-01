import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { poemsSeed } from './seeds/poem/poems.seed';

const prisma = new PrismaClient();

const userData: Prisma.UserCreateInput[] = [
  {
    firstName: 'Sébastien',
    lastName: 'Vanvelthem',
    nickname: 'belgattitude',
    email: 'belgattitude@gmail.com',
    Post: {
      create: [
        {
          title: 'Nextjs monorepo example',
          slug: 'first-post',
          link: 'https://github.com/belgattitude/nextjs-monorepo-example',
          content: 'Hello world',
          image:
            'https://images.unsplash.com/photo-1625904835711-fa25795530e8?ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&ixlib=rb-1.2.1&auto=format&fit=crop&w=1052&q=80',
          publishedAt: new Date(),
        },
      ],
    },
  },
];

async function main() {
  console.log(`Start seeding ...`);
  // users and posts
  for (const u of userData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: u,
    });
    console.log(`Created or updated user with id: ${user.id}`);
  }
  // poems
  for (const poem of poemsSeed) {
    const { keywords, ...poemWithoutKeywords } = poem;
    await prisma.poem.upsert({
      where: {
        slug: poem.slug,
      },
      update: {
        ...poemWithoutKeywords,
      },
      create: poem,
    });
    console.log(`Created or updated poem with slug: ${poem.slug}`);
  }
  console.log(`Seeding finished.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
