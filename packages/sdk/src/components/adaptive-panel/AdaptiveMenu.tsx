import { Check } from '@teable/icons';
import {
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerSafeArea,
  DrawerTitle,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { DrawerStackContext } from './DrawerStackContext';
import { useIsDrawerPanel } from './useIsDrawerLayout';

export interface IAdaptiveMenuOption {
  value: string | number;
  label: string;
  Icon?: React.FC<{ className?: string }>;
}

export interface IAdaptiveMenuSection {
  key: string;
  /**
   * Visible group heading. Omit when it would merely repeat the drawer title -
   * pass `ariaLabel` instead so the group is still named for a screen reader.
   */
  label?: string;
  ariaLabel?: string;
  value?: string | number;
  options: IAdaptiveMenuOption[];
  onSelect: (value: string | number) => void;
}

export interface IAdaptiveMenuProps {
  responsive?: boolean;
  /** Trigger. Rendered once, as the trigger of whichever root wins. */
  children: React.ReactNode;
  title: string;
  /** Data-driven sections, used for the drawer rendering only. */
  sections: IAdaptiveMenuSection[];
  /** The existing desktop menu body, rendered unchanged inside a dropdown. */
  desktop: React.ReactNode;
  overlay?: React.ReactNode;
  desktopClassName?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * The dropdown-menu flavour of `AdaptivePanel`.
 *
 * Row height is a menu on desktop rather than a popover, and demoting it to a
 * popover just to share one shell would be a desktop behaviour change. So the
 * desktop side keeps its `DropdownMenu` verbatim while the mobile side goes
 * through the same drawer as every other toolbar panel.
 */
export const AdaptiveMenu = (props: IAdaptiveMenuProps) => {
  const {
    responsive,
    children,
    title,
    sections,
    desktop,
    overlay,
    desktopClassName,
    side = 'bottom',
    align = 'start',
  } = props;

  const { t } = useTranslation();
  const isDrawer = useIsDrawerPanel(responsive);
  const [isOpen, setIsOpen] = useState(false);
  const labelIdPrefix = useId();

  const close = useCallback(() => setIsOpen(false), []);
  const stack = useMemo(() => ({ depth: 1, close }), [close]);

  if (!isDrawer) {
    return (
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align} className={desktopClassName}>
          {desktop}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader closeLabel={t('common.close')}>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <DrawerStackContext.Provider value={stack}>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {overlay}
            <DrawerBody className="p-2">
              {sections.map((section, index) => {
                const labelId = `${labelIdPrefix}-${section.key}`;
                return (
                  <div key={section.key} className={cn(index > 0 && 'mt-2 border-t pt-2')}>
                    {section.label && (
                      <div
                        id={labelId}
                        className="px-3 py-2 text-xs font-normal text-muted-foreground"
                      >
                        {section.label}
                      </div>
                    )}
                    {/* A labelled group of toggle buttons rather than a
                        `radiogroup`: the ARIA radio pattern moves selection
                        with arrow keys, and because picking an option closes
                        this drawer, one arrow press would dismiss it. Plain
                        buttons carry no arrow-key contract, and `aria-pressed`
                        still announces which option is active - the fallback
                        the spec allows. The group keeps its name so screen
                        readers still announce "Field name" etc. */}
                    <div
                      role="group"
                      aria-labelledby={section.label ? labelId : undefined}
                      aria-label={section.label ? undefined : section.ariaLabel ?? title}
                      className="flex flex-col"
                    >
                      {section.options.map(({ value, label, Icon }) => {
                        const checked = section.value === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={checked}
                            className={cn(
                              'flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm outline-none',
                              'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                              checked && 'bg-accent text-accent-foreground'
                            )}
                            onClick={() => {
                              section.onSelect(value);
                              // Every other option drawer in this toolbar
                              // dismisses on pick; this one matches.
                              close();
                            }}
                          >
                            {Icon && <Icon className="size-4 shrink-0 text-lg" />}
                            <span className="flex-1 truncate text-start">{label}</span>
                            {checked && <Check className="size-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </DrawerBody>
          </div>
        </DrawerStackContext.Provider>
        <DrawerSafeArea />
      </DrawerContent>
    </Drawer>
  );
};
