import { Injectable } from '@nestjs/common';
import { AuthRepository } from '../repositories/auth.repository';

@Injectable()
export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  health() {
    return {
      module: 'auth',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
