import type { InputProps } from '@teable/ui-lib';
import { Input } from '@teable/ui-lib';
import { forwardRef } from 'react';
import { useTranslation } from '../../context/app/i18n';

export const RecordSearch = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, placeholder, ...props }, ref) => {
    const { t } = useTranslation();
    return (
      <div className="relative p-0.5">
        <Input
          ref={ref}
          type={type}
          className={className}
          placeholder={placeholder || t('editor.link.searchPlaceholder')}
          {...props}
        />
      </div>
    );
  }
);

RecordSearch.displayName = 'RecordSearch';
