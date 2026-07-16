'use client';

import type { UseMutationOptions } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface UseApiMutationOptions<TData, TVariables = void>
  extends Pick<UseMutationOptions<TData, Error, TVariables>, 'retry' | 'onSuccess' | 'onError'> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  invalidateQueries?: (string | number | boolean | null | undefined)[][];
  updateQueries?: Array<{
    queryKey: (string | number | boolean | null | undefined)[];
    updater: (oldData: unknown, newData: TData) => unknown;
  }>;
}

/**
 * Manages mutations with automatic cache invalidation and updates for React Query.
 * Defaults (retry) inherit from QueryProvider unless overridden.
 */
export const useApiMutation = <TData, TVariables = void>({
  mutationFn,
  invalidateQueries = [],
  updateQueries = [],
  onSuccess,
  onError,
  retry,
}: UseApiMutationOptions<TData, TVariables>) => {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    retry,
    onSuccess: (data, variables, context, meta) => {
      invalidateQueries.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });

      updateQueries.forEach(({ queryKey, updater }) => {
        queryClient.setQueryData(queryKey, (oldData: unknown) =>
          oldData ? updater(oldData, data) : data,
        );
      });

      onSuccess?.(data, variables, context, meta);
    },
    onError,
  });
};
