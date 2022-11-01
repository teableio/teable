import { css } from '@emotion/react';
import { sayHello } from '@teable-group/core-lib';
import { Message } from '@teable-group/ui-lib';
import { GradientText } from '@teable-group/ui-lib/ux/text/GradientText';
import type { FC } from 'react';

export const HomePage: FC = () => {
  return (
    <div>
      <h1 className="text-6xl font-bold text-red-700">Hello World!</h1>
      <h3
        css={css`
          font-size: 3em;
          font-weight: 800;
        `}
      >
        I'm the remix-app
      </h3>
      <p>
        <GradientText
          css={css`
            position: relative;
            font-size: 3em;
            font-weight: 800;
          `}
        >
          Hello
        </GradientText>
      </p>
      <p>{`${sayHello('Hello Remix')} from @teable-group/core-lib`}</p>
      <p>
        <Message message={'React component from @teable-group/ui-lib'} />
      </p>
    </div>
  );
};
