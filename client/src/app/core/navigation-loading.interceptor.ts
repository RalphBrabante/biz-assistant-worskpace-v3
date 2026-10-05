import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { defer, finalize } from 'rxjs';
import { NavigationLoadingService } from './navigation-loading.service';

export const navigationLoadingInterceptor: HttpInterceptorFn = (request, next) => {
  const navigation = inject(NavigationLoadingService);
  // Authentication/polling and writes do not control page-content feedback.
  if (request.method !== 'GET' || !/\/api\/v1\//.test(request.url) ||
      /\/api\/v1\/(auth|dev)\//.test(request.url) ||
      /\/api\/v1\/messages\/unread-count(?:\?|$)/.test(request.url)) return next(request);
  return defer(() => {
    const complete = navigation.trackRead();
    return next(request).pipe(finalize(complete));
  });
};
