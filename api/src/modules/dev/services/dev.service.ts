import { Injectable } from '@nestjs/common';
import { DevRepository } from '../repositories/dev.repository';

@Injectable()
export class DevService {
  constructor(private readonly repository: DevRepository) {}

  health() {
    return {
      module: 'dev',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
