import type { IconProps } from '@/types/common/Props';

export const CalendarIcon = (props: IconProps) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M3 9.5h18M8 3v4M16 3v4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
