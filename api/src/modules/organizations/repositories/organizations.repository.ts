import { Injectable } from '@nestjs/common';

@Injectable()
export class OrganizationsRepository {
  name(): string {
    return 'organizations';
  }
}
