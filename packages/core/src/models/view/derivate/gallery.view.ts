import z from 'zod';
import type { IGalleryColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';

export interface IGalleryView extends IViewVo {
  type: ViewType.Gallery;
  options: IGalleryViewOptions;
}

export type IGalleryViewOptions = z.infer<typeof galleryViewOptionSchema>;

export const galleryViewOptionSchema = z
  .object({
    coverFieldId: z.string().optional().nullable().openapi({
      description:
        'The cover field id is a designated attachment field id, the contents of which appear at the top of each gallery card.',
    }),
    isCoverFit: z.boolean().optional().openapi({
      description: 'If true, cover images are resized to fit gallery cards.',
    }),
    isFieldNameHidden: z.boolean().optional().openapi({
      description: 'If true, hides field name in the gallery cards.',
    }),
  })
  .strict();

export class GalleryViewCore extends ViewCore {
  type!: ViewType.Gallery;

  options!: IGalleryViewOptions;

  columnMeta!: IGalleryColumnMeta;
}
