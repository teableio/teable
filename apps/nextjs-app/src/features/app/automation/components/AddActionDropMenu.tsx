import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib';

interface IAddActionDropMenuProps {
  children: React.ReactElement;
}

const AddActionDropMenu = (props: IAddActionDropMenuProps) => {
  const { children } = props;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children || (
          <div className="hover:opacity-60 mt-8 border-2 border-gray-400 cursor-pointer rounded h-16 flex items-center justify-center border-dashed">
            Add advanced logic or action
          </div>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
        <DropdownMenuLabel>Advanced Logic</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            Conditional logic
            <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Repeating group
            <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem>Teable</DropdownMenuItem>
          <DropdownMenuItem>Send email</DropdownMenuItem>
          <DropdownMenuItem>Create record</DropdownMenuItem>
          <DropdownMenuItem>Update record</DropdownMenuItem>
          <DropdownMenuItem>Find record</DropdownMenuItem>
          <DropdownMenuItem disabled>Run script</DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>Integrations</DropdownMenuItem>
          <DropdownMenuItem>
            New Team
            <DropdownMenuShortcut>⌘+T</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { AddActionDropMenu };
