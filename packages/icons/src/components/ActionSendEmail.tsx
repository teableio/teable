import * as React from 'react';
import type { SVGProps } from 'react';

interface ActionSendEmailProps extends SVGProps<SVGSVGElement> {
  withBackground?: boolean;
}

const ActionSendEmail = ({ withBackground = true, ...props }: ActionSendEmailProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    {withBackground && <rect width="24" height="24" fill="#3B82F6" fillOpacity="0.1" />}
    <path
      d="M17.5 13.5C18.0523 13.5 18.5 13.9477 18.5 14.5V15.5H19.5C20.0523 15.5 20.5 15.9477 20.5 16.5C20.5 17.0523 20.0523 17.5 19.5 17.5H18.5V18.5C18.5 19.0523 18.0523 19.5 17.5 19.5C16.9477 19.5 16.5 19.0523 16.5 18.5V17.5H15.5C14.9477 17.5 14.5 17.0523 14.5 16.5C14.5 15.9477 14.9477 15.5 15.5 15.5H16.5V14.5C16.5 13.9477 16.9477 13.5 17.5 13.5ZM18.5 5C19.6046 5 20.5 5.89543 20.5 7V12C20.5 12.5523 20.0523 13 19.5 13C18.9477 13 18.5 12.5523 18.5 12V9.72852L12.9268 12.6436C12.3462 12.9472 11.6538 12.9472 11.0732 12.6436L5.5 9.72852V17H12C12.5523 17 13 17.4477 13 18C13 18.5523 12.5523 19 12 19H5.5C4.39543 19 3.5 18.1046 3.5 17V7C3.5 5.89543 4.39543 5 5.5 5H18.5ZM5.5 7.4707L12 10.8711L18.5 7.4707V7H5.5V7.4707Z"
      fill="#3B82F6"
    />
  </svg>
);
export default ActionSendEmail;
