import * as React from 'react';
import type { SVGProps } from 'react';
const Slack = (props: SVGProps<SVGSVGElement>) => (
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
      d="M16 3.5a1.5 1.5 0 0 0-3 0v5a1.5 1.5 0 0 0 3 0v-5ZM19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5ZM11 15.5a1.5 1.5 0 0 0-3 0v5a1.5 1.5 0 0 0 3 0v-5ZM5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5ZM20.5 13h-5a1.5 1.5 0 0 0 0 3h5a1.5 1.5 0 0 0 0-3ZM15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5ZM8.5 8h-5a1.5 1.5 0 1 0 0 3h5a1.5 1.5 0 0 0 0-3ZM8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5Z"
    />
  </svg>
);
export default Slack;
