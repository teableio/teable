import * as React from 'react';
import type { SVGProps } from 'react';
const UserCog = (props: SVGProps<SVGSVGElement>) => (
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
      d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19 8v1M19 13v1M21.6 9.5l-.87.5M17.27 12l-.87.5M21.6 12.5l-.87-.5M17.27 10l-.87-.5"
    />
  </svg>
);
export default UserCog;
