import * as React from 'react';
import type { SVGProps } from 'react';
const FolderKey = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 20H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H20a2 2 0 0 1 2 2v2M16 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM22 14l-4.5 4.5M21 15l1 1"
    />
  </svg>
);
export default FolderKey;
