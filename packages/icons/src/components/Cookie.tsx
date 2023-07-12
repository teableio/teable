import * as React from 'react';
import type { SVGProps } from 'react';
const Cookie = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5ZM8.5 8.5v.01M16 15.5v.01M12 12v.01M11 17v.01M7 14v.01"
    />
  </svg>
);
export default Cookie;
