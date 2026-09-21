import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthRepository {
  name(): string {
    return 'auth';
  }
}
