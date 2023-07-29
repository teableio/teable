import Image from 'next/image';
const images = ['Girl1', 'Boy1', 'Girl2', 'Boy3', 'Girl3'];
export const Collaborators: React.FC = () => {
  return (
    <div className="flex gap-1 px-2">
      {images.map((name) => {
        return (
          <div
            key={name}
            className="grow-0 shrink-0 relative overflow-hidden rounded-[50px] border border-slate-200"
          >
            <Image
              width={28}
              height={28}
              loading={'eager'}
              src={`/shared-assets/example/${name}.png`}
              alt={'tailwind-ui-logo'}
              className="rounded object-cover object-center"
            />
          </div>
        );
      })}
      <div className="grow-0 shrink-0 relative overflow-hidden rounded-[50px] border border-slate-200">
        <p className="w-7 h-7 text-sm text-center flex items-center justify-center">+7</p>
      </div>
    </div>
  );
};
