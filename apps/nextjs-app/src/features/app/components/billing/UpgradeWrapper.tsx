import { Role } from '@teable/core';
import { BillingProductLevel } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import type { Base } from '@teable/sdk/model';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useMemo, useCallback, type ReactElement, cloneElement } from 'react';
import { useBillingLevel } from '../../hooks/useBillingLevel';
import { useBillingLevelConfig } from '../../hooks/useBillingLevelConfig';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useIsCommunity } from '../../hooks/useIsCommunity';
import { useIsEE } from '../../hooks/useIsEE';

interface IUpgradeWrapperRenderProps {
  badge: ReactElement | null;
  needsUpgrade: boolean;
  isCommunity: boolean;
  currentLevel?: BillingProductLevel;
}

interface IUpgradeWrapperProps {
  children?: ReactElement | ((props: IUpgradeWrapperRenderProps) => ReactElement);
  spaceId?: string;
  baseId?: string;
  targetBillingLevel?: BillingProductLevel;
  onUpgradeClick?: () => void;
}

const getBillingLevelWeight = (level?: BillingProductLevel): number => {
  const levelMap: Record<BillingProductLevel, number> = {
    [BillingProductLevel.Free]: 1,
    [BillingProductLevel.Plus]: 2,
    [BillingProductLevel.Pro]: 3,
    [BillingProductLevel.Enterprise]: 4,
  };
  return level ? levelMap[level] : 0;
};

const isLevelSufficient = (
  currentLevel?: BillingProductLevel,
  targetLevel?: BillingProductLevel
): boolean => {
  if (!targetLevel) return true;
  return getBillingLevelWeight(currentLevel) >= getBillingLevelWeight(targetLevel);
};

export const UpgradeWrapper: React.FC<IUpgradeWrapperProps> = ({
  children,
  spaceId,
  targetBillingLevel,
  onUpgradeClick,
}) => {
  const router = useRouter();
  const isCloud = useIsCloud();
  const isCommunity = useIsCommunity();
  const isEE = useIsEE();
  const base = useBase() as Base | undefined;
  const { t } = useTranslation('common');
  spaceId = base?.spaceId ?? spaceId;
  const baseId = base?.id;
  // EE starts from pro level
  targetBillingLevel =
    targetBillingLevel === BillingProductLevel.Plus && isEE
      ? BillingProductLevel.Pro
      : targetBillingLevel;

  const currentLevel = useBillingLevel(baseId ? { baseId } : { spaceId });

  const isLevelSufficientMemo = useMemo(() => {
    return isLevelSufficient(currentLevel, targetBillingLevel);
  }, [currentLevel, targetBillingLevel]);

  const isSpaceOwner = useMemo(() => {
    return base?.role === Role.Owner;
  }, [base?.role]);

  const needsUpgrade =
    currentLevel && !isLevelSufficientMemo && !!targetBillingLevel && !isCommunity;

  const handleUpgradeClick = useCallback(() => {
    if (onUpgradeClick) {
      onUpgradeClick();
      return;
    }

    if (isCloud) {
      if (!spaceId) {
        toast.error('Base ID is required for billing upgrade');
        return;
      }

      if (!isSpaceOwner) {
        toast.warning(t('billing.spaceSubscriptionModal.description'));
        return;
      }

      router.push(`/space/${spaceId}/setting/plan`);
    } else {
      window.open('https://app.teable.ai/public/pricing?host=self-hosted', '_blank');
    }
  }, [onUpgradeClick, isCloud, spaceId, isSpaceOwner, t, router]);

  const billingConfig = useBillingLevelConfig(targetBillingLevel);

  // 创建badge组件
  const badge = useMemo(() => {
    if (!needsUpgrade) {
      return null;
    }

    return (
      <span
        className={`cursor-pointer rounded px-1 text-[10px] leading-[16px] ${billingConfig.upgradeTagCls}`}
        onClick={handleUpgradeClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleUpgradeClick();
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={`Upgrade to ${billingConfig.name}`}
      >
        {billingConfig.name}
      </span>
    );
  }, [needsUpgrade, billingConfig, handleUpgradeClick]);

  if (typeof children === 'function') {
    const element = children({
      badge,
      needsUpgrade: Boolean(needsUpgrade),
      isCommunity,
      currentLevel,
    });
    return cloneElement(element, {
      onClickCapture: (e: Event) => {
        if (!needsUpgrade) return;
        e.preventDefault();
        e.stopPropagation();
        handleUpgradeClick();
      },
    });
  }

  if (!children) {
    return badge;
  }

  if (isCommunity) {
    return null;
  }

  if (isLevelSufficientMemo) {
    return children;
  }

  return cloneElement(children, {
    onClickCapture: (e: Event) => {
      if (!needsUpgrade) return;
      e.preventDefault();
      e.stopPropagation();
      handleUpgradeClick();
    },
  });
};
