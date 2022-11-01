import { css } from '@emotion/react';
import type { ComponentStory, ComponentMeta } from '@storybook/react';
import React, { useState } from 'react';
import { useIntervalWhen } from 'rooks';
import { GradientText } from './GradientText';

// More on default export: https://storybook.js.org/docs/react/writing-stories/introduction#default-export
export default {
  title: 'Experimental/GradientText',
  component: GradientText,
  // More on argTypes: https://storybook.js.org/docs/react/api/argtypes
  // argTypes: {
  //   bg: {
  //     options: ['sky', 'green', 'blue', 'red'],
  //   },
  // },
} as ComponentMeta<typeof GradientText>;

export const BasicExample: ComponentStory<typeof GradientText> = (args) => (
  <div
    style={{
      maxWidth: '500px',
      border: '1px solid blue',
      fontSize: '3em',
      fontWeight: 800,
    }}
  >
    <span>
      Hello world, this is a long text that will be wrapped to multiple lines{' '}
      <GradientText {...args}>the sky is full of surprises</GradientText>
    </span>
  </div>
);

const titles = [
  ['Typescript', 'sky'],
  ['React', 'orange'],
  ['Nextjs', 'sky'],
  ['Prisma', 'orange'],
  ['Emotion', 'green'],
] as const;

export const AnimatedExample: ComponentStory<typeof GradientText> = (_args) => {
  const [activeIdx, setActiveIdx] = useState(0);
  useIntervalWhen(() => {
    setActiveIdx((idx) => (idx >= titles.length - 1 ? 0 : idx + 1));
  }, 2000);
  return (
    <div className={'overflow-hidden max-w-md rounded shadow-lg m-8 p-16'}>
      <span className={'font-bold text-3xl w-full'}>
        <span>
          Picked from the possibles <br /> made with{' '}
        </span>{' '}
        <span
          style={{
            position: 'relative',
            visibility: 'hidden',
          }}
        >
          Typescript
          {titles.map((title, idx) => {
            const [label, grad] = titles[idx];
            const curr = idx === activeIdx;
            return (
              <GradientText
                className={curr ? 'fadeIn' : 'fadeOut'}
                css={css`
                  visibility: visible;
                `}
                key={`${label}-${idx}`}
                bg={grad}
              >
                {label}
              </GradientText>
            );
          })}
        </span>
        What do you think?
      </span>
    </div>
  );
};
