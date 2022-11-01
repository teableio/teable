import type { FC } from 'react';
import type { SearchPoems } from '@/backend/features/poem/SearchPoems';

type Poem = SearchPoems[0];

type Props = {
  img: Poem['image'];
  title: Poem['title'];
  author: Poem['author'];
  content: Poem['content'];
  keywords: Poem['keywords'];
  defaultImg?: string;
  children?: never;
};

export const PoemCard: FC<Props> = (props) => {
  const { img, content, author, title, keywords, defaultImg } = props;
  const image = img ?? defaultImg;
  return (
    <div className="max-w-sm overflow-hidden rounded shadow-lg">
      <div className="aspect-w-16 aspect-h-9 h-56 lg:aspect-none">
        <img
          className="h-full w-full object-cover object-center lg:h-full lg:w-full"
          src={image ?? ''}
          alt={title}
        />
      </div>
      <article className="prose py-4 px-6">
        <div className="mb-2 text-xl font-bold">{title}</div>
        <p className="text-indigo-600">By {author}</p>
        <p className="text-base text-gray-700 line-clamp-4">{content}</p>
      </article>
      <div className="px-6 pt-4 pb-2">
        {keywords.map((keyword) => {
          return (
            <span
              key={keyword}
              className="mr-2 mb-2 inline-block rounded-full bg-gray-200 py-1 px-3 text-sm font-semibold text-gray-700"
            >
              #{keyword}
            </span>
          );
        })}
      </div>
    </div>
  );
};
