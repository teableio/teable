import * as React from 'react';
import type { SVGProps } from 'react';
const UserEdit = (props: SVGProps<SVGSVGElement>) => (
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
      d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19.85 6.369a1.26 1.26 0 0 1 1.781 1.781L18.37 11.4 16 12l.594-2.369z"
    />
  </svg>
);
export default UserEdit;
