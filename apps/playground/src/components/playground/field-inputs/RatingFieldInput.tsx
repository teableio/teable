import { Star } from 'lucide-react';
import { type RatingField } from '@teable/v2-core';
import { cn } from '@/lib/utils';
import type { FieldInputProps } from './types';

export function RatingFieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  // Cast to RatingField to access rating-specific methods
  const ratingField = field as RatingField;
  const max = ratingField.ratingMax().toNumber();
  const currentValue = typeof value === 'number' ? value : 0;

  const handleClick = (rating: number) => {
    if (disabled) return;
    // If clicking the same rating, clear it
    onChange(currentValue === rating ? null : rating);
  };

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((rating) => (
        <button
          key={rating}
          type="button"
          onClick={() => handleClick(rating)}
          disabled={disabled}
          className={cn(
            'p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <Star
            className={cn(
              'h-5 w-5 transition-colors',
              rating <= currentValue
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-transparent text-muted-foreground hover:text-yellow-300'
            )}
          />
        </button>
      ))}
      <span className="ml-2 text-sm text-muted-foreground">
        {currentValue > 0 ? `${currentValue}/${max}` : `0/${max}`}
      </span>
    </div>
  );
}
