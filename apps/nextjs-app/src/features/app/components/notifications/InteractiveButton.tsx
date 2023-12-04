import type { ButtonProps } from '@teable-group/ui-lib';
import { Button } from '@teable-group/ui-lib';
import React, { useState } from 'react';

interface InteractiveButtonProps extends ButtonProps {
  defaultIcon: React.ReactNode;
  hoverIcon: React.ReactNode;
}

export const InteractiveButton: React.FC<InteractiveButtonProps> = (props) => {
  const { defaultIcon, hoverIcon, onClick } = props;
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Button
      {...props}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {isHovered ? hoverIcon : defaultIcon}
    </Button>
  );
};
