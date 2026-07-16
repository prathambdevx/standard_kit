'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { SelectChevronDownIcon } from '@/assets/icons/select_chevron_down_icon';
import { cn } from '@/lib/cn';

export type SelectOption = { value: string; label: string; textValue?: string };

interface SelectProps {
  options: SelectOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  name?: string; // renders a hidden native select so FormData captures the value
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Branded dropdown — replaces the unstyleable native <select> popup with a white, themed list. */
export const Select = ({
  options,
  value,
  onValueChange,
  placeholder = 'Select',
  name,
  required,
  disabled,
  className,
}: SelectProps) => (
  <SelectPrimitive.Root
    value={value}
    onValueChange={onValueChange}
    name={name}
    required={required}
    disabled={disabled}
  >
    <SelectPrimitive.Trigger
      className={cn(
        'group flex h-12 w-full cursor-pointer items-center justify-between rounded-lg border border-line bg-surface-default px-4 fl-text-[16,16] leading-[1.4] tracking-[0.02em] text-ink outline-none transition-colors',
        'data-[state=open]:border-ink data-[placeholder]:text-muted',
        'disabled:cursor-default disabled:opacity-60',
        className,
      )}
    >
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon asChild>
        <SelectChevronDownIcon className="shrink-0 text-dim transition-transform duration-(--motion-duration-fast) group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>

    <SelectPrimitive.Portal>
      {/* z above the drawer (z-101) so the list isn't clipped by the dialog */}
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className="z-[110] max-h-[280px] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface-default shadow-lg"
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center bg-surface-default text-dim">
          <SelectChevronDownIcon className="rotate-180" />
        </SelectPrimitive.ScrollUpButton>

        <SelectPrimitive.Viewport className="p-1">
          {options.map((option) => (
            <SelectPrimitive.Item
              key={option.value}
              value={option.value}
              // Radix typeahead matches from the start of the item's text - a leading flag
              // emoji (or other non-alphabetic prefix) would break jump-to-letter search.
              textValue={option.textValue ?? option.label}
              className={cn(
                'relative flex cursor-pointer items-center rounded-md px-3 py-2.5',
                'fl-text-[14,16] leading-[1.4] tracking-[0.02em]', // fl-input-floor-exempt: popover list item, not a text-entry control
                'text-ink outline-none select-none data-[highlighted]:bg-surface-muted data-[state=checked]:font-medium',
              )}
            >
              <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>

        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center bg-surface-default text-dim">
          <SelectChevronDownIcon />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
);
