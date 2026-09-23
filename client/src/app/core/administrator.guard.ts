import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const administratorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isPrivileged() || inject(Router).parseUrl('/profile');
};
