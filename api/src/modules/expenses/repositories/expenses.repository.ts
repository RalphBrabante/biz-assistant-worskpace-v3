import { Injectable } from '@nestjs/common';

@Injectable()
export class ExpensesRepository {
  name(): string {
    return 'expenses';
  }
}
