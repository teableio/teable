'use client';

import { DollarSign } from '@teable/icons';
import type { IGatewayModel } from '@teable/openapi';
import {
  Button,
  Input,
  Badge,
  Label,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@teable/ui-lib/shadcn';

interface IPricingSectionProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  pricing: IGatewayModel['pricing'];
  modelType?: string;
  onPricingChange: (
    field: 'input' | 'output' | 'inputCacheRead' | 'inputCacheWrite' | 'image' | 'webSearch',
    value: string
  ) => void;
}

export function PricingSection({
  expanded,
  onExpandedChange,
  pricing,
  modelType,
  onPricingChange,
}: IPricingSectionProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between">
          <span className="flex items-center gap-2">
            <DollarSign className="size-4" />
            Pricing (USD per token)
            {pricing?.input && (
              <Badge variant="secondary" className="text-xs">
                ✓
              </Badge>
            )}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            USD per token (same format as Vercel AI Gateway API). e.g., 0.000003 = $3/1M tokens
          </p>

          {modelType === 'image' ? (
            <div>
              <Label className="text-xs">Per Image (USD)</Label>
              <Input
                type="text"
                value={pricing?.image ?? ''}
                onChange={(e) => onPricingChange('image', e.target.value)}
                placeholder="0.04"
                className="mt-1 h-8"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Input ($/token)</Label>
                <Input
                  type="text"
                  value={pricing?.input ?? ''}
                  onChange={(e) => onPricingChange('input', e.target.value)}
                  placeholder="0.000003"
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Output ($/token)</Label>
                <Input
                  type="text"
                  value={pricing?.output ?? ''}
                  onChange={(e) => onPricingChange('output', e.target.value)}
                  placeholder="0.000015"
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Cache Read</Label>
                <Input
                  type="text"
                  value={pricing?.inputCacheRead ?? ''}
                  onChange={(e) => onPricingChange('inputCacheRead', e.target.value)}
                  placeholder="0.0000003"
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Cache Write</Label>
                <Input
                  type="text"
                  value={pricing?.inputCacheWrite ?? ''}
                  onChange={(e) => onPricingChange('inputCacheWrite', e.target.value)}
                  placeholder="0.00000375"
                  className="mt-1 h-8"
                />
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
