import { Injectable } from '@nestjs/common';
import { ProfileRepository } from '../repositories/profile.repository';

@Injectable()
export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  health() {
    return {
      module: 'profile',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
