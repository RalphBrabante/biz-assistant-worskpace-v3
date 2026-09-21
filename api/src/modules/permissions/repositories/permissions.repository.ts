import { Injectable } from '@nestjs/common';

@Injectable()
export class PermissionsRepository {
  name(): string {
    return 'permissions';
  }
}
