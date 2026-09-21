import { Injectable } from '@nestjs/common';

@Injectable()
export class DevRepository {
  name(): string {
    return 'dev';
  }
}
