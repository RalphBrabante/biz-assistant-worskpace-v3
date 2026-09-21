import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersRepository {
  name(): string {
    return 'users';
  }
}
