import * as React from 'react';
import type { SVGProps } from 'react';
const ListVideo = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 12H3M16 6H3M12 18H3M16 12l5 3-5 3v-6Z"
    />
  </svg>
);
export default ListVideo;
