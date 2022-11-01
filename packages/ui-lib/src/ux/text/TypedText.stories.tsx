import { css } from '@emotion/react';
import type { ComponentStory, ComponentMeta } from '@storybook/react';
import React from 'react';
import { TypedText } from './TypedText';

// More on default export: https://storybook.js.org/docs/react/writing-stories/introduction#default-export
export default {
  title: 'Experimental/TypedText',
  component: TypedText,
  // More on argTypes: https://storybook.js.org/docs/react/api/argtypes
  // argTypes: {
  //   bg: {
  //     options: ['sky', 'green', 'blue', 'red'],
  //   },
  // },
} as ComponentMeta<typeof TypedText>;

export const BasicExample: ComponentStory<typeof TypedText> = (args) => {
  return (
    <div>
      <span
        style={{
          fontFamily: 'Inter, Ubuntu',
          maxWidth: '900px',
          border: '1px solid blue',
          fontSize: '3em',
          fontWeight: 900,
          lineHeight: '1.5em',
          display: 'flex',
        }}
      >
        <div>
          <div
            className={
              'container overflow-hidden w-full rounded shadow-lg m-8 p-16'
            }
          >
            <TypedText
              css={css`
                border: 1px solid grey;
                padding: 15px 10px;
                border-radius: 91% 9% 90% 10% / 29% 82% 18% 71%;
                background-color: blueviolet;
                color: white;
              `}
              {...args}
            >
              Hello world
            </TypedText>
          </div>
        </div>
      </span>
    </div>
  );
};
