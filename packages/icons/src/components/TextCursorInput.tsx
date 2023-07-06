import * as React from 'react';
import type { SVGProps } from 'react';
const TextCursorInput = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 20h-1a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1M5 4h1a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5M13.1 7.9h6.8A2.18 2.18 0 0 1 22 10v4a2.11 2.11 0 0 1-2.1 2.1h-6.8M4.8 16.1h-.7A2.18 2.18 0 0 1 2 14v-4a2.18 2.18 0 0 1 2.1-2.1h.7"
    />
  </svg>
);
export default TextCursorInput;
