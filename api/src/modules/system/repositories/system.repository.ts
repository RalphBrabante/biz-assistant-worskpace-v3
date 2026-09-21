import { Injectable } from '@nestjs/common';

@Injectable()
export class SystemRepository {
  name(): string {
    return 'system';
  }
}
