import { Controller, Get, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { proxyLegacyRoute } from '../../legacy/legacy-route-proxy';

@Controller('api/v1/dashboard')
export class DashboardController {
  @Get('monthly-summary')
  async monthlySummary(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    return proxyLegacyRoute('dashboard', req, res, next);
  }
}
