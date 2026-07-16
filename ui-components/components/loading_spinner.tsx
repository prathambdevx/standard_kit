import type React from 'react';

import { LoaderIcon } from '@/assets/icons/loader_icon';
import { cn } from '@/lib/cn';

interface LoadingSpinnerProps {
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ className = 'h-5 w-5' }) => {
  return <LoaderIcon className={cn('animate-spin', className)} />;
};
