import { Injectable } from '@nestjs/common';

@Injectable()
export class ReportsRepository {
  name(): string {
    return 'reports';
  }
}
