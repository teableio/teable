import * as React from 'react';
import type { SVGProps } from 'react';
const Axe = (props: SVGProps<SVGSVGElement>) => (
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
      d="m14 12-8.501 8.501a2.12 2.12 0 0 1-2.998 0h-.002a2.12 2.12 0 0 1 0-2.998L11 9.002"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m9 7 4-4 6 6h3l-.13.648a7.649 7.649 0 0 1-5.081 5.756L15 16v-3L9 7Z"
    />
  </svg>
);
export default Axe;
