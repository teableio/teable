/**
 * Automatically add app-providers
 * @see https://testing-library.com/docs/react-testing-library/setup#configuring-jest-with-test-utils
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { AppTestProviders, TestAnchorProvider } from './AppTestProviders';

/** Recommended in vitest only for cleanup
import { cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
}); */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customRender = (ui: ReactElement, options?: any) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  render(ui, {
    wrapper: AppTestProviders,
    ...options,
  });

// re-export everything
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';

// override render method
export { customRender as render, TestAnchorProvider };
