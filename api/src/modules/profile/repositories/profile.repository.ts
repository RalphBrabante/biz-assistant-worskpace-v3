import { Injectable } from '@nestjs/common';

@Injectable()
export class ProfileRepository {
  name(): string {
    return 'profile';
  }
}
