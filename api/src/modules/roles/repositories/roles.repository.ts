import { Injectable } from '@nestjs/common';

@Injectable()
export class RolesRepository {
  name(): string {
    return 'roles';
  }
}
