import { AsyncLocalStorage } from 'node:async_hooks';
import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { isoDate } from '@ananda/shared';

/**
 * "As of" (header calendar in the web). The web sends `x-as-of: YYYY-MM-DD` while someone looks back
 * at a past day. For that request:
 *  - `asOfDay()` is that day and `asOfNow()` is the end of it (23:59:59.999 local time), so
 *    FiguresService answers the Overview tiles, owed / late and collections figures as they were;
 *  - every write is refused with 409 `looking_back` ("nothing can be changed here"), except the
 *    person's own things (sign-in, profile, notifications, AI polish).
 * Without the header (or with today or a future day) nothing changes.
 */
const store = new AsyncLocalStorage<{ day: string | null }>();

/** The past day being looked at, or null for today. */
export function asOfDay(): string | null {
  return store.getStore()?.day ?? null;
}

/** "Now" for figures: the end of the as-of day, or the real now. */
export function asOfNow(): Date {
  const d = asOfDay();
  if (!d) return new Date();
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd, 23, 59, 59, 999);
}

const LIVE = /^\/api\/(auth|notifications|ai)(\/|$)/;

@Injectable()
export class AsOfInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-as-of'];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const day = v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v < isoDate() ? v : null;
    if (day && req.method !== 'GET' && req.method !== 'HEAD' && !LIVE.test(req.path)) {
      throw new ConflictException({ message: "You're looking back at a past day. Nothing can be changed.", code: 'looking_back' });
    }
    if (!day) return next.handle();
    return new Observable((sub) => store.run({ day }, () => next.handle().subscribe(sub)));
  }
}
