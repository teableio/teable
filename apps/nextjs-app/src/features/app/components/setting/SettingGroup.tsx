import type { ReactNode } from 'react';

/** A titled list of setting rows in one bordered box, the rows split by hairlines. */
export const SettingGroup = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
    <div className="divide-y rounded-lg border bg-card">{children}</div>
  </section>
);

interface ISettingRowProps {
  label: ReactNode;
  /** The id of the row's own field, so the label focuses it. */
  htmlFor?: string;
  description?: ReactNode;
  /** The row's control; on phones it drops under the text. */
  action?: ReactNode;
}

export const SettingRow = ({ label, htmlFor, description, action }: ISettingRowProps) => (
  <div className="flex flex-col items-stretch gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
    <div className="flex min-w-0 flex-col gap-0.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
      ) : (
        <p className="text-sm font-medium">{label}</p>
      )}
      {description && <div className="text-xs text-muted-foreground">{description}</div>}
    </div>
    {action && <div className="flex shrink-0">{action}</div>}
  </div>
);
