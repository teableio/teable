import * as React from 'react';
import type { SVGProps } from 'react';
const Info = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M12 11.5C12.5523 11.5 13 11.9477 13 12.5V17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17V12.5C11 11.9477 11.4477 11.5 12 11.5Z"
      fill="currentColor"
    />
    <path
      d="M12 6.5C12.8284 6.5 13.5 7.17157 13.5 8C13.5 8.82843 12.8284 9.5 12 9.5C11.1716 9.5 10.5 8.82843 10.5 8C10.5 7.17157 11.1716 6.5 12 6.5Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 1C18.0751 1 23 5.92487 23 12C23 18.0751 18.0751 23 12 23C5.92487 23 1 18.0751 1 12C1 5.92487 5.92487 1 12 1ZM12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3Z"
      fill="currentColor"
    />
  </svg>
);
export default Info;
