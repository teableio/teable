import * as React from 'react';
import type { SVGProps } from 'react';
const TeableLine = (props: SVGProps<SVGSVGElement>) => (
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
      strokeLinejoin="round"
      strokeMiterlimit={10.471}
      strokeWidth={2}
      d="M11.4 2.536 5.139 4.772a.3.3 0 0 0-.04.547l6.742 3.596A.3.3 0 0 1 12 9.18v11.978c0 .32.435.418.571.128L19.86 5.8a.3.3 0 0 0-.172-.41L11.6 2.535a.3.3 0 0 0-.2 0Z"
    />
  </svg>
);
export default TeableLine;
