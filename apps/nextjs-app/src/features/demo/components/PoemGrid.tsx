import { ArrayUtils } from '@teable-group/ts-utils';
import type { FC } from 'react';
import type { SearchPoems } from '@/_backend/features/poem/SearchPoems';
import { PoemCard } from './PoemCard';

const waterImages = new Array(25).fill('').map((img, idx) => {
  const index = String(idx + 1).padStart(2, '0');
  return `/shared-assets/images/water/water-${index}.jpg`;
});

export const PoemGrid: FC<{ poems: SearchPoems; children?: never }> = (
  props
) => {
  const { poems } = props;
  let images = waterImages;
  return (
    <div className="flex flex-wrap">
      {poems.map((poem) => {
        const randomImg = ArrayUtils.getRandom(images);
        const defaultImg = `/_next/image?url=${encodeURIComponent(
          randomImg
        )}&w=640&q=85`;
        images =
          images.length < 1
            ? waterImages
            : ArrayUtils.removeItem(images, randomImg);

        const unsplashImg = `https://source.unsplash.com/random/640x480?${(
          poem.keywords ?? []
        )
          .map((keyword) => encodeURIComponent(keyword))
          .join(',')}`;

        return (
          <div
            key={`${poem.id}`}
            className="m-2 w-full sm:w-1/2 md:w-1/3 lg:w-1/4 xl:w-1/6"
          >
            <PoemCard
              title={poem.title}
              content={poem.content}
              author={poem.author}
              keywords={poem.keywords}
              img={unsplashImg}
              defaultImg={defaultImg}
            />
          </div>
        );
      })}
    </div>
  );
};
