import * as React from 'react';
import type { SVGProps } from 'react';
const FilePresentation = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-presentation)">
      <path
        fill="#FFB900"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm5.944 16.522q.21.145.7.145.488 0 .699-.145a.6.6 0 0 0 .264-.37q.053-.237.053-.488v-1.73h1.69q.554 0 1.121-.198.568-.21 1.043-.607.489-.409.779-1.016.303-.607.303-1.413 0-.817-.303-1.425a3 3 0 0 0-.779-1.017 3.1 3.1 0 0 0-1.043-.62 3.3 3.3 0 0 0-1.109-.198H9.536q-.487 0-.7.145a.61.61 0 0 0-.263.383 2 2 0 0 0-.053.475v7.207q0 .251.053.489a.63.63 0 0 0 .25.383m3.418-4.594H10.54V9.446h1.69q.369 0 .646.159.29.158.449.435.158.277.158.647 0 .435-.198.713a1.1 1.1 0 0 1-.475.41q-.277.117-.568.118"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__file-presentation">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FilePresentation;
