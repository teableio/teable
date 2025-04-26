export const LoadingDot = () => {
  return (
    <div className="flex h-7 items-center space-x-1">
      <span className="size-1 animate-[bounce_1s_infinite] rounded-full bg-gray-500"></span>
      <span className="size-1 animate-[bounce_1s_infinite_0.2s] rounded-full bg-gray-500"></span>
      <span className="size-1 animate-[bounce_1s_infinite_0.4s] rounded-full bg-gray-500"></span>
    </div>
  );
};
