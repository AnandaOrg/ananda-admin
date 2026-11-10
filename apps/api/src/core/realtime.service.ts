import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Subject, tap, type Observable } from 'rxjs';

export interface RealtimeEvent {
  /** Query keys the clients should refetch; '*' means everything visible. */
  topics: string[];
  userId?: string;
}

/** Counts, badges and lists update without reload after an action (PRD §10, Real time). */
@Injectable()
export class RealtimeService {
  readonly events$ = new Subject<RealtimeEvent>();

  emit(topics: string[], userId?: string) {
    this.events$.next({ topics, userId });
  }
}

/** After any successful write, tell every open client to refetch what it shows. */
@Injectable()
export class RealtimeInterceptor implements NestInterceptor {
  constructor(private readonly realtime: RealtimeService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method === 'GET') return next.handle();
    return next.handle().pipe(tap(() => this.realtime.emit(['*'])));
  }
}
