/**
 * Automatically add app-providers
 * @see https://testing-library.com/docs/react-testing-library/setup#configuring-jest-with-test-utils
 */
import { render } from '@testing-library/react';
import type { FC, PropsWithChildren, ReactElement } from 'react';

const AppTestProviders: FC<PropsWithChildren> = (props) => (
  <>{props.children}</>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customRender = (ui: ReactElement, options?: any) =>
  render(ui, { wrapper: AppTestProviders, ...options });

// re-export everything
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

// override render method
export { customRender as render };
