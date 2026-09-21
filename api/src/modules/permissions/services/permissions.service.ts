import { Injectable } from '@nestjs/common';
import { PermissionsRepository } from '../repositories/permissions.repository';

@Injectable()
export class PermissionsService {
  constructor(private readonly repository: PermissionsRepository) {}

  health() {
    return {
      module: 'permissions',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
