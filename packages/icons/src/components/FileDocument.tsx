import * as React from 'react';
import type { SVGProps } from 'react';
const FileDocument = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-document)">
      <path
        fill="#2684FF"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm6.099 16.579q.198.132.541.132.37 0 .568-.145a1 1 0 0 0 .303-.344 1.3 1.3 0 0 0 .106-.25l1.518-4.924 1.518 4.924.106.25q.091.172.303.33.211.159.568.159.37 0 .554-.132a.8.8 0 0 0 .277-.29q.093-.173.12-.251l2.48-7.194q.107-.37.093-.594a.54.54 0 0 0-.158-.396q-.158-.159-.555-.304-.37-.132-.62-.106a.6.6 0 0 0-.396.212q-.145.171-.264.54l-1.637 4.911-1.399-4.87q-.04-.093-.119-.265a.8.8 0 0 0-.29-.316q-.199-.146-.607-.146-.357 0-.555.132a.86.86 0 0 0-.29.304 2.4 2.4 0 0 0-.119.304l-1.386 4.83-1.65-4.896q-.12-.37-.277-.542a.52.52 0 0 0-.383-.184q-.225-.014-.594.105-.567.185-.686.462-.12.264.052.819l2.482 7.194q.027.066.106.237a.86.86 0 0 0 .29.304"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__file-document">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileDocument;
