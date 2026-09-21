import { All, Controller, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../../legacy/legacy-route-proxy';

@Controller('api/v1/users')
export class UsersController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('users', req, res, next);
  }

  @All(':path(.*)')
  async proxyNested(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('users', req, res, next);
  }
}
