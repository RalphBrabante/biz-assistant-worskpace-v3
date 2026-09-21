import { Injectable } from '@nestjs/common';

@Injectable()
export class CustomersRepository {
  name(): string {
    return 'customers';
  }
}
