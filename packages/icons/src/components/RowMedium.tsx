import * as React from 'react';
import type { SVGProps } from 'react';
const RowMedium = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M13 19C13.5523 19 14 19.4477 14 20C14 20.5523 13.5523 21 13 21H3C2.44772 21 2 20.5523 2 20C2 19.4477 2.44772 19 3 19H13ZM13 13.5C13.5523 13.5 14 13.9477 14 14.5C14 15.0523 13.5523 15.5 13 15.5H3C2.44772 15.5 2 15.0523 2 14.5C2 13.9477 2.44772 13.5 3 13.5H13ZM13 2.5C13.5523 2.5 14 2.94772 14 3.5V9C14 9.55228 13.5523 10 13 10H3C2.44772 10 2 9.55228 2 9V3.5C2 2.94772 2.44772 2.5 3 2.5H13ZM4 8H12V4.5H4V8Z"
      fill="currentColor"
    />
    <path
      d="M19 21L19 3M19 21L21 19M19 21L17 19M19 3L17 5M19 3L21 5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default RowMedium;
