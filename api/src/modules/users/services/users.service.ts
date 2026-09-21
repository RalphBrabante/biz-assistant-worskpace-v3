import { Injectable } from '@nestjs/common';
import { UsersRepository } from '../repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  health() {
    return {
      module: 'users',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
