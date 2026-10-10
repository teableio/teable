import * as React from 'react';
import type { SVGProps } from 'react';

const LayoutGridPlus = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M17.5 12.75C17.9142 12.75 18.25 13.0858 18.25 13.5V16.75H21.5C21.9142 16.75 22.25 17.0858 22.25 17.5C22.25 17.9142 21.9142 18.25 21.5 18.25H18.25V21.5C18.25 21.9142 17.9142 22.25 17.5 22.25C17.0858 22.25 16.75 21.9142 16.75 21.5V18.25H13.5C13.0858 18.25 12.75 17.9142 12.75 17.5C12.75 17.0858 13.0858 16.75 13.5 16.75H16.75V13.5C16.75 13.0858 17.0858 12.75 17.5 12.75Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9 13C10.1046 13 11 13.8954 11 15V20C11 21.1046 10.1046 22 9 22H4C2.89543 22 2 21.1046 2 20V15C2 13.8954 2.89543 13 4 13H9ZM4 20H9V15H4V20Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9 2C10.1046 2 11 2.89543 11 4V9C11 10.1046 10.1046 11 9 11H4C2.89543 11 2 10.1046 2 9V4C2 2.89543 2.89543 2 4 2H9ZM4 9H9V4H4V9Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M20 2C21.1046 2 22 2.89543 22 4V9C22 10.1046 21.1046 11 20 11H15C13.8954 11 13 10.1046 13 9V4C13 2.89543 13.8954 2 15 2H20ZM15 9H20V4H15V9Z"
      fill="currentColor"
    />
  </svg>
);

export default LayoutGridPlus;
