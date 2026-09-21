import { Controller, Get, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../../legacy/legacy-route-proxy';

@Controller('api/v1')
export class SystemController {
  @Get()
  async root(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('system', req, res, next);
  }

  @Get('health')
  async health(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('system', req, res, next);
  }
}
