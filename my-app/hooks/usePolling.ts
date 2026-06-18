import { useState, useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  interval?: number;
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
  enabled?: boolean;
}

interface UsePollingResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isPolling: boolean;
  lastUpdated: Date | null;
  stopPolling: () => void;
  startPolling: () => void;
  togglePolling: () => void;
  refresh: () => Promise<void>;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  options: UsePollingOptions = {}
): UsePollingResult<T> {
  const {
    interval = 30000, // 30 seconds default
    onSuccess,
    onError,
    enabled = true
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPolling, setIsPolling] = useState<boolean>(enabled);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  
  // Use refs for fetcher and callbacks to avoid recreating fetchData
  const fetcherRef = useRef(fetcher);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  
  // Keep refs up to date
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);
  
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);
  
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Function to fetch data - now with stable dependencies
  const fetchData = useCallback(async (silent = false) => {
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    if (!silent) setIsLoading(true);

    const request = (async () => {
      try {
        const result = await fetcherRef.current();

        if (mountedRef.current) {
          setData(result);
          setError(null);
          setLastUpdated(new Date());
          if (!silent) setIsLoading(false);
          onSuccessRef.current?.(result);
        }
      } catch (err) {
        if (mountedRef.current) {
          const errorObj = err instanceof Error ? err : new Error(String(err));
          setError(errorObj);
          if (!silent) setIsLoading(false);
          onErrorRef.current?.(errorObj);
        }
      }
    })();

    inFlightRef.current = request;
    const clearInFlight = () => {
      if (inFlightRef.current === request) {
        inFlightRef.current = null;
      }
    };
    request.then(clearInFlight, clearInFlight);

    return request;
  }, []); // No dependencies - uses refs

  // Initial fetch - runs only once on mount
  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [fetchData]);

  // Polling logic
  useEffect(() => {
    if (isPolling && interval > 0) {
      const poll = async () => {
        await fetchData(true); // Silent update
        if (mountedRef.current && isPolling) {
          timeoutRef.current = setTimeout(poll, interval);
        }
      };

      // Start the loop
      timeoutRef.current = setTimeout(poll, interval);

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    }
  }, [isPolling, interval, fetchData]);

  const stopPolling = useCallback(() => setIsPolling(false), []);
  const startPolling = useCallback(() => setIsPolling(true), []);
  const togglePolling = useCallback(() => setIsPolling((prev: boolean) => !prev), []);
  const refresh = useCallback(async () => {
    await fetchData(false);
  }, [fetchData]);

  return {
    data,
    error,
    isLoading,
    isPolling,
    lastUpdated,
    stopPolling,
    startPolling,
    togglePolling,
    refresh
  };
}
