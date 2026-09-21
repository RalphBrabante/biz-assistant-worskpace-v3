import { Injectable } from '@nestjs/common';
import { ExpensesRepository } from '../repositories/expenses.repository';

@Injectable()
export class ExpensesService {
  constructor(private readonly repository: ExpensesRepository) {}

  health() {
    return {
      module: 'expenses',
      status: 'ok',
      repository: this.repository.name(),
    };
  }
}
