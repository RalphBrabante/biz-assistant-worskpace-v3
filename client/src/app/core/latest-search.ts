import { Observable, OperatorFunction, catchError, defer, map, of, startWith, switchMap, timer } from 'rxjs';

export interface SearchState<T> {
  status: 'idle' | 'loading' | 'success' | 'error';
  results: T[];
}

/** Cancel on every input, including clears; debounce only the new request. */
export function latestSearch<T>(
  search: (query: string) => Observable<T[]>,
  debounceMs: number,
  minLength = 2
): OperatorFunction<string, SearchState<T>> {
  return switchMap((value) => {
    const query = value.trim();
    if (query.length < minLength) {
      return of<SearchState<T>>({ status: 'idle', results: [] });
    }

    // Do not deduplicate queries: a reset or retry can repeat the previous text.
    return timer(debounceMs).pipe(
      switchMap(() => defer(() => search(query))),
      map((results): SearchState<T> => ({ status: 'success', results })),
      catchError(() => of<SearchState<T>>({ status: 'error', results: [] })),
      startWith<SearchState<T>>({ status: 'loading', results: [] })
    );
  });
}
