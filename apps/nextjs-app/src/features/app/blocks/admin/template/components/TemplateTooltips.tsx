import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';

interface ITooltipsProps {
  children: React.ReactNode;
  content: string;
  disabled?: boolean;
}

export function TemplateTooltips(props: ITooltipsProps) {
  const { children, content, disabled } = props;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{children}</div>
        </TooltipTrigger>
        {disabled && <TooltipContent>{content}</TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  );
}
