'use client';

import { Trash2, Image as ImageIcon } from '@teable/icons';
import type { IGatewayModel, IModelAbility, GatewayModelProvider } from '@teable/openapi';
import { Button, Switch, Badge, cn } from '@teable/ui-lib/shadcn';
import { GATEWAY_PROVIDER_ICONS } from '../constant';
import { CAPABILITY_LABELS } from '../GatewayModelPickerDialog';
import { formatUsdPriceShort } from './utils';

// Extract provider from model ID (e.g., "anthropic/claude-sonnet-4.5" -> "anthropic")
function getProviderFromModelId(modelId: string): GatewayModelProvider | undefined {
  const provider = modelId.split('/')[0];
  if (provider && provider in GATEWAY_PROVIDER_ICONS) {
    return provider as GatewayModelProvider;
  }
  return undefined;
}

interface IModelCardProps {
  model: IGatewayModel;
  showPricing: boolean;
  onToggleEnabled: (modelId: string, enabled: boolean) => void;
  onRemove: (modelId: string) => void;
}

export function ModelCard({ model, showPricing, onToggleEnabled, onRemove }: IModelCardProps) {
  // Try ownedBy first, fallback to extracting from model ID
  const provider = model.ownedBy || getProviderFromModelId(model.id);
  const ProviderIcon = provider
    ? GATEWAY_PROVIDER_ICONS[provider as keyof typeof GATEWAY_PROVIDER_ICONS]
    : undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-4 transition-colors',
        model.enabled ? 'bg-card' : 'bg-muted text-muted-foreground'
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {ProviderIcon && <ProviderIcon className="size-4 shrink-0" />}
          <span className="font-medium">{model.label}</span>
          {/* Show pricing (only in Cloud) */}
          {showPricing &&
            model.pricing &&
            (model.pricing.input || model.pricing.output || model.pricing.image) && (
              <Badge
                variant="outline"
                className={cn(
                  'px-2 text-[11px]',
                  model.enabled ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {model.modelType === 'image' && model.pricing.image
                  ? `$${model.pricing.image}/img`
                  : `${formatUsdPriceShort(model.pricing.input)}/${formatUsdPriceShort(model.pricing.output)}`}
              </Badge>
            )}
          {/* Show Image badge based on modelType or isImageModel flag */}
          {(model.modelType === 'image' ||
            model.isImageModel ||
            model.tags?.includes('image-generation')) && (
            <Badge variant="secondary" className="text-xs">
              <ImageIcon className="mr-1 size-3" />
              Image
            </Badge>
          )}
          {/* Show Embedding badge for embedding models */}
          {(model.modelType === 'embedding' || model.id.toLowerCase().includes('embedding')) && (
            <Badge variant="secondary" className="text-xs">
              Embed
            </Badge>
          )}
        </div>

        <code className="text-xs text-muted-foreground">{model.id}</code>

        {model.capabilities && (
          <div className="flex gap-1">
            {Object.entries(model.capabilities)
              .filter(([, v]) => v)
              .map(([key]) => (
                <Badge
                  key={key}
                  variant="outline"
                  className={cn(
                    'bg-muted text-[11px] font-normal',
                    model.enabled ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {CAPABILITY_LABELS[key as keyof IModelAbility] || key}
                </Badge>
              ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={model.enabled}
          onCheckedChange={(checked) => onToggleEnabled(model.id, checked)}
        />

        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0 text-muted-foreground"
          onClick={() => onRemove(model.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
