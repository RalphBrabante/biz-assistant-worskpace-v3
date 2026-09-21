import { Injectable } from '@nestjs/common';
import { RolesRepository } from '../repositories/roles.repository';

@Injectable()
export class RolesService {
  constructor(private readonly repository: RolesRepository) {}

  health() {
    return {
      module: 'roles',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
