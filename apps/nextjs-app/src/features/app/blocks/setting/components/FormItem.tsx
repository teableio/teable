import { Error } from '@teable/ui-lib/base';
import { Label } from '@teable/ui-lib/shadcn';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { z } from 'zod';
import { RequireCom } from './RequireCom';

interface IFormItemProps {
  title: string;
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
  const { title, description, required, children, validateSchema } = props;
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

  return (
    <div ref={containerRef}>
      <div className="space-y-2">
        <Label>
          {title} {required && <RequireCom />}
          {description && (
            <div className="text-xs font-normal text-muted-foreground">{description}</div>
          )}
        </Label>
        {children}
      </div>
      <Error className="text-xs" error={error} />
    </div>
  );
});

FormItem.displayName = 'OAuthFormItem';
