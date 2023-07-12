import * as React from 'react';
import type { SVGProps } from 'react';
const DatabaseBackup = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 8c4.97 0 9-1.343 9-3s-4.03-3-9-3-9 1.343-9 3 4.03 3 9 3ZM3 12c0 1.18 2.03 2.2 5 2.7M21 5v4.5M12 16l1.27-1.35a4.75 4.75 0 1 1 .41 5.74"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 12v4h4M3 5v14c0 1.43 2.97 2.63 7 2.93"
    />
  </svg>
);
export default DatabaseBackup;
