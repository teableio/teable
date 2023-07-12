import * as React from 'react';
import type { SVGProps } from 'react';
const JapaneseYen = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 9.5V21m0-11.5L6 3m6 6.5L18 3M6 15h12M6 11h12"
    />
  </svg>
);
export default JapaneseYen;
