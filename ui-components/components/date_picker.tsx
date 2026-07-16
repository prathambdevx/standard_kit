'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { CalendarIcon } from '@/assets/icons/calendar_icon';
import { ChevronMiniLeftIcon } from '@/assets/icons/chevron_mini_left_icon';
import { ChevronMiniRightIcon } from '@/assets/icons/chevron_mini_right_icon';
import { cn } from '@/lib/cn';

/** Parses a YYYY-MM-DD string into a local Date without timezone offset. */
const parseLocalDate = (iso: string): Date | undefined => {
  if (!iso) return undefined;
  const parts = iso.split('-').map(Number);
  if (parts.length < 3) return undefined;
  return new Date(parts[0] as number, (parts[1] as number) - 1, parts[2] as number);
};

/** Formats a Date to YYYY-MM-DD in local time. */
const toLocalIso = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Formats a Date to a readable display string (e.g. "20 Jun 2026"). */
const formatDisplay = (date: Date): string =>
  date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  error?: boolean;
}

export const DatePicker = ({
  id,
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  error,
}: DatePickerProps) => {
  const [open, setOpen] = useState(false);

  const selected = parseLocalDate(value);
  const minDate = min ? parseLocalDate(min) : undefined;
  const maxDate = max ? parseLocalDate(max) : undefined;
  const defaultMonth = selected ?? minDate ?? new Date();

  const handleSelect = (date: Date | undefined) => {
    if (!date) return;
    onChange(toLocalIso(date));
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            'flex fl-h-[40,48] w-full cursor-pointer items-center justify-between rounded-lg border border-dim/30 bg-surface-default px-4 fl-text-[16,16] leading-[1.4] tracking-[0.02em] outline-none transition-colors',
            selected ? 'text-ink' : 'text-muted',
            error ? 'border-status-error' : open ? 'border-dim' : '',
          )}
        >
          <span>{selected ? formatDisplay(selected) : placeholder}</span>
          <CalendarIcon className="size-5 shrink-0 text-ink" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 rounded-xl border border-line bg-surface-default p-4 shadow-lg outline-none animate-in fade-in-0 zoom-in-95"
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            defaultMonth={defaultMonth}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            classNames={{
              root: 'w-[280px]',
              months: 'flex flex-col',
              month: 'flex flex-col gap-3',
              month_caption: 'flex items-center justify-between px-1',
              caption_label: 'text-[14px] leading-none tracking-[0.02em] font-semibold text-ink',
              nav: 'flex items-center gap-1',
              button_previous: cn(
                'flex size-7 items-center justify-center rounded-md text-dim transition-colors',
                'hover:bg-surface-muted hover:text-ink',
                'disabled:pointer-events-none disabled:opacity-30',
              ),
              button_next: cn(
                'flex size-7 items-center justify-center rounded-md text-dim transition-colors',
                'hover:bg-surface-muted hover:text-ink',
                'disabled:pointer-events-none disabled:opacity-30',
              ),
              month_grid: 'w-full border-collapse',
              weekdays: 'flex',
              weekday:
                'flex-1 pb-2 text-center text-[12px] leading-none tracking-[0.03em] text-muted select-none',
              week: 'flex mt-1',
              day: 'flex-1',
              day_button: cn(
                'mx-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-[12px] leading-none tracking-[0.03em] text-ink transition-colors',
                'hover:bg-surface-muted',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
              ),
              selected: '[&>button]:bg-ink [&>button]:text-white [&>button]:hover:bg-ink/90',
              today: '[&>button]:font-semibold [&>button]:text-ink',
              outside: '[&>button]:text-muted [&>button]:opacity-40',
              disabled:
                '[&>button]:cursor-not-allowed [&>button]:text-muted [&>button]:opacity-30 [&>button]:hover:bg-transparent',
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === 'left' ? (
                  <ChevronMiniLeftIcon className="size-3 text-current" />
                ) : (
                  <ChevronMiniRightIcon className="size-3 text-current" />
                ),
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};
