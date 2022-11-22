import type { FC } from 'react';

const titles: [string, string][] = [
  ['Typescript', 'sky'],
  ['React', 'orange'],
  ['Nextjs', 'violet'],
  ['Prisma', 'yellow'],
  ['Emotion', 'fun'],
];

export const Jumbotron: FC = () => {
  return (
    <div>
      One of many possibles
      <br /> made with
      {titles.map((_, idx) => {
        const [label] = titles[idx];
        return label;
      })}
    </div>
  );
};
