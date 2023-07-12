import * as React from 'react';
import type { SVGProps } from 'react';
const Radio = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4.93 19.07a10 10 0 0 1 0-14.14M7.76 16.24a6 6 0 0 1 0-8.49M16.24 7.76a6 6 0 0 1 1.3 2 6 6 0 0 1-1.3 6.54M19.07 4.93a10 10 0 0 1 0 14.14"
    />
  </svg>
);
export default Radio;
