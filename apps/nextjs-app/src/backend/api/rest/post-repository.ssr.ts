import { HttpInternalServerError, HttpNotFound } from '@belgattitude/http-exception';
import type { UnPromisify } from '@teable-group/core';
import { assertNonEmptyString } from '@teable-group/core';
import type { PrismaClientDbMain } from '@teable-group/db-main-prisma';

export type IGetPosts = UnPromisify<ReturnType<typeof PostRepositorySsr['prototype']['getPosts']>>;

export class PostRepositorySsr {
  constructor(private prisma: PrismaClientDbMain) {}

  /**
   * @throws Error
   */
  getPost = async (postId: number) => {
    try {
      const post = this.prisma.post.findUnique({
        where: { id: postId },
        include: { author: true },
      });
      assertNonEmptyString(post, () => new HttpNotFound(`Post ${postId} can't be found`));
      return post;
    } catch (e) {
      throw new HttpInternalServerError({
        message: `Post ${postId} can't be retrieved`,
        cause: e instanceof Error ? e : undefined,
      });
    }
  };

  /**
   * @throws Error
   */
  getPosts = async (options?: { limit?: number; offset?: number }) => {
    const { limit, offset } = options ?? {};
    try {
      return await this.prisma.post.findMany({
        skip: offset,
        take: limit,
        where: {
          publishedAt: {
            not: null,
          },
        },
        include: {
          author: {
            select: {
              firstName: true,
              lastName: true,
              nickname: true,
            },
          },
        },
        orderBy: { publishedAt: 'desc' },
      });
    } catch (e) {
      throw new HttpInternalServerError({
        message: `Posts can't be retrieved`,
        cause: e instanceof Error ? e : undefined,
      });
    }
  };
}
