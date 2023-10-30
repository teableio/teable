import classNames from 'classnames';
import Image from 'next/image';
const images = ['Girl1', 'Boy1', 'Girl2', 'Boy3', 'Girl3'];
export const Collaborators: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={classNames('gap-1 px-2 items-center hidden sm:flex', className)}>
      {images.map((name) => {
        return (
          <div key={name} className="relative overflow-hidden">
            <Image
              width={28}
              height={28}
              loading={'eager'}
              src={`/shared-assets/example/${name}.png`}
              alt={'tailwind-ui-logo'}
              className="shrink-0 rounded-[50px] border border-slate-200 object-cover object-center"
            />
          </div>
        );
      })}
      <div className="relative shrink-0 grow-0 overflow-hidden rounded-[50px] border border-slate-200">
        <p className="flex h-7 w-7 items-center justify-center text-center text-sm">+7</p>
      </div>
    </div>
  );
};
