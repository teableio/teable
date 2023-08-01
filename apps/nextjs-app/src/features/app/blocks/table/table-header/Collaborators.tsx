import classNames from 'classnames';
import Image from 'next/image';
const images = ['Girl1', 'Boy1', 'Girl2', 'Boy3', 'Girl3'];
export const Collaborators: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div className={classNames('flex gap-1 px-2 items-center', className)}>
      {images.map((name) => {
        return (
          <div key={name} className="relative overflow-hidden">
            <Image
              width={28}
              height={28}
              loading={'eager'}
              src={`/shared-assets/example/${name}.png`}
              alt={'tailwind-ui-logo'}
              className="object-cover object-center shrink-0 rounded-[50px] border border-slate-200"
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
