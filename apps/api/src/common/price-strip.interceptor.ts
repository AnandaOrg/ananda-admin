import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';

// Every money field in the API ends in "Cents"; the rest are named for what they hold.
const MONEY_KEY = /(Cents$|^cents$|price|Price|cost|Cost|commission|Commission|profit|Profit|stockValue|margin|Margin)/;

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (MONEY_KEY.test(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

/**
 * Users without "See prices and stock values" (Warehouse by default) never receive prices,
 * totals, stock values or costs in any response (FR-AUTH-3). Handlers already shape their
 * responses; this removes anything that slips through.
 */
@Injectable()
export class PriceStripInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const hide = req.auth && !req.auth.perms.sensitive.includes('see_prices');
    return hide ? next.handle().pipe(map(strip)) : next.handle();
  }
}
