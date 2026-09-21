import { Injectable } from '@nestjs/common';
import { OrganizationsRepository } from '../repositories/organizations.repository';

@Injectable()
export class OrganizationsService {
  constructor(private readonly repository: OrganizationsRepository) {}

  health() {
    return {
      module: 'organizations',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
