import { Injectable } from '@nestjs/common';
import { SystemRepository } from '../repositories/system.repository';

@Injectable()
export class SystemService {
  constructor(private readonly repository: SystemRepository) {}

  health() {
    return {
      module: 'system',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
