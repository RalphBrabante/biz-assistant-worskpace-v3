import { Injectable } from '@nestjs/common';
import { ReportsRepository } from '../repositories/reports.repository';

@Injectable()
export class ReportsService {
  constructor(private readonly repository: ReportsRepository) {}

  health() {
    return {
      module: 'reports',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
