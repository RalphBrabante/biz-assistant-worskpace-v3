import { Injectable } from '@nestjs/common';

@Injectable()
export class VendorsRepository {
  name(): string {
    return 'vendors';
  }
}
