import { Injectable } from '@nestjs/common';
import { LicensesRepository } from '../repositories/licenses.repository';

@Injectable()
export class LicensesService {
  constructor(private readonly repository: LicensesRepository) {}

  health() {
    return {
      module: 'licenses',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
