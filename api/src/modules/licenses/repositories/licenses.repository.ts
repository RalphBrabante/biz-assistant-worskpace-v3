import { Injectable } from '@nestjs/common';

@Injectable()
export class LicensesRepository {
  name(): string {
    return 'licenses';
  }
}
