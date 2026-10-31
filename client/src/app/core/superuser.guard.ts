import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OrganizationContextService } from './organization-context.service';

// Role templates apply across organizations, so they stay with platform staff.
export const superuserGuard: CanActivateFn = () => {
  return inject(OrganizationContextService).isSuperuser() || inject(Router).parseUrl('/organization-roles');
};
