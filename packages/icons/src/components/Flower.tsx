import * as React from 'react';
import type { SVGProps } from 'react';
const Flower = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 7.5a4.5 4.5 0 1 1 4.5 4.5M12 7.5A4.5 4.5 0 1 0 7.5 12M12 7.5V9m4.5 3a4.5 4.5 0 1 1-4.5 4.5m4.5-4.5H15m-7.5 0a4.5 4.5 0 1 0 4.5 4.5M7.5 12H9m3 4.5V15"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 16l1.5-1.5M14.5 9.5 16 8M8 8l1.5 1.5M14.5 14.5 16 16"
    />
  </svg>
);
export default Flower;
