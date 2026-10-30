import type { PrismaService } from '@teable/db-main-prisma';
import { URL_KEY_MAX_LENGTH } from '@teable/openapi';
import { slugify } from 'transliteration';

type ITemplateSlugClient = {
  template: Pick<PrismaService['template'], 'findFirst' | 'findUniqueOrThrow' | 'updateMany'>;
};

/** "Client CRM" -> "client-crm"; non-Latin names are transliterated. Empty when nothing is left. */
export const slugFromName = (name: string | null | undefined): string =>
  slugify(name ?? '', { lowercase: true, separator: '-' })
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, URL_KEY_MAX_LENGTH)
    .replace(/-$/, '');

/**
 * Gives a template its public URL name the first time it is listed, and keeps it from then on:
 * links on the official site must not break when the template is renamed. The name's slug,
 * or the id when the name has nothing to slug; a taken slug gets the next free `-2`, `-3`…
 *
 * Only an empty slug is written, so two readers naming the same template at once cannot
 * overwrite each other: the second finds the first's slug and returns it. Two different
 * templates taking the same slug at once leave one of them on the unique index; it moves on
 * to the next suffix (inside a transaction that retry fails with it, and the caller's whole
 * write is rolled back).
 */
export async function ensureTemplateSlug(
  prisma: ITemplateSlugClient,
  template: { id: string; name: string | null; slug: string | null }
): Promise<string> {
  if (template.slug) return template.slug;
  const base = slugFromName(template.name) || template.id.toLowerCase();
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base.slice(0, URL_KEY_MAX_LENGTH - `-${n}`.length)}-${n}`;
    if (await prisma.template.findFirst({ where: { slug }, select: { id: true } })) continue;
    try {
      const { count } = await prisma.template.updateMany({
        where: { id: template.id, slug: null },
        data: { slug },
      });
      if (count) return slug;
      const named = await prisma.template.findUniqueOrThrow({
        where: { id: template.id },
        select: { slug: true },
      });
      return named.slug ?? slug;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
}

const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 'P2002';
