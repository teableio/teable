import { Avatar, AvatarFallback, cn } from '@teable/ui-lib/shadcn';

const AVATAR_COLORS = [
  'bg-red-400',
  'bg-orange-400',
  'bg-amber-400',
  'bg-yellow-400',
  'bg-lime-400',
  'bg-green-400',
  'bg-emerald-400',
  'bg-teal-400',
  'bg-cyan-400',
  'bg-sky-400',
  'bg-blue-400',
  'bg-indigo-400',
  'bg-violet-400',
  'bg-purple-400',
  'bg-fuchsia-400',
];

const getColorFromString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

interface ISpaceAvatarProps {
  name: string;
  className?: string;
}

export const SpaceAvatar = ({ name, className }: ISpaceAvatarProps) => {
  const bgColor = getColorFromString(name);
  const initial = name?.charAt(0).toUpperCase() || '?';

  return (
    <Avatar className={cn('shrink-0 rounded border', className)}>
      <AvatarFallback className={cn('rounded text-white font-medium', bgColor)}>
        {initial}
      </AvatarFallback>
    </Avatar>
  );
};
