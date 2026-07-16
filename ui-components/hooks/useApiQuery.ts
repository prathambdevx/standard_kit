'use client';

import type { UseQueryOptions } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';

export interface UseApiQueryOptions<TData>
  extends Pick<
    UseQueryOptions<TData>,
    'staleTime' | 'gcTime' | 'retry' | 'enabled' | 'placeholderData'
  > {
  queryKey: (string | number | boolean | null | undefined)[];
  queryFn: () => Promise<TData>;
}

/**
 * Generic hook for fetching and caching data with React Query.
 * Defaults (staleTime, gcTime, retry) inherit from QueryProvider unless overridden.
 */
export const useApiQuery = <TData>({
  queryKey,
  queryFn,
  enabled = true,
  staleTime,
  gcTime,
  retry,
  placeholderData,
}: UseApiQueryOptions<TData>) => {
  return useQuery({
    queryKey,
    queryFn,
    enabled,
    staleTime,
    gcTime,
    retry,
    placeholderData,
  });
};
