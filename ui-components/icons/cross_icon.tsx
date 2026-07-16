import type { IconProps } from '@/types/common/Props';

export const CrossIcon = ({ className, ...props }: IconProps) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
    {...props}
  >
    <g clipPath="url(#clip0_35052_35577)">
      <path
        d="M0.234315 0.234315C0.522702 -0.0540726 0.976487 -0.0762562 1.29032 0.167764L1.36569 0.234315L15.7657 14.6343C16.0781 14.9467 16.0781 15.4533 15.7657 15.7657C15.4773 16.0541 15.0235 16.0763 14.7097 15.8322L14.6343 15.7657L0.234315 1.36569C-0.0781049 1.05327 -0.0781049 0.546734 0.234315 0.234315Z"
        fill="currentColor"
      />
      <path
        d="M14.6343 0.234315C14.9467 -0.0781049 15.4533 -0.0781049 15.7657 0.234315C16.0541 0.522702 16.0763 0.976487 15.8322 1.29032L15.7657 1.36569L1.36569 15.7657C1.05327 16.0781 0.546734 16.0781 0.234315 15.7657C-0.0540726 15.4773 -0.0762562 15.0235 0.167764 14.7097L0.234315 14.6343L14.6343 0.234315Z"
        fill="currentColor"
      />
    </g>
    <defs>
      <clipPath id="clip0_35052_35577">
        <rect width="16" height="16" fill="white" />
      </clipPath>
    </defs>
  </svg>
);
