import { Error } from '@teable/ui-lib/base';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { z } from 'zod';
import { RequireCom } from './RequireCom';

interface IFormItemProps {
  title: React.ReactNode;
  titleExtra?: React.ReactNode;
  description?: string;
  required?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateSchema?: z.Schema<any, any>;
  children: React.ReactNode;
}

export interface IFormItemRef {
  validate: (value: unknown) => boolean;
  reset: () => void;
}

export const FormItem = forwardRef<IFormItemRef, IFormItemProps>((props, ref) => {
  const { title, titleExtra, description, required, children, validateSchema } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useImperativeHandle(ref, () => ({
    validate: (value: unknown) => {
      if (!validateSchema) {
        return true;
      }
      const res = validateSchema.safeParse(value);
      if (!res.success) {
        containerRef.current?.scrollIntoView({ behavior: 'smooth' });
        setError(res.error.issues[0]?.message ?? 'Invalid');
      }
      return res.success;
    },
    reset: () => {
      setError(undefined);
    },
  }));

  // A settings row: label and description on the left, the field (and its error) on the right.
  return (
    <div
      ref={containerRef}
      className="flex flex-col items-stretch gap-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-0.5 sm:pt-2">
        <div className="text-sm font-medium">
          {title} {required && <RequireCom />} {titleExtra}
        </div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-64">
        {children}
        <Error className="text-xs" error={error} />
      </div>
    </div>
  );
});

FormItem.displayName = 'OAuthFormItem';
