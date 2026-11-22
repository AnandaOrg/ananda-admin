import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { acceptInviteSchema, profileSchema, signInLinkSchema, twoStepSchema, verifyLinkSchema } from '@ananda/shared';
import { AllowInPreview, Auth, BeforeTwoStep, Public, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { SESSION_COOKIE } from '../common/auth.guard';
import { randomToken } from '../core/crypto';
import { webOrigin } from '../core/origin';
import { AuthService, safeNext } from './auth.service';
import { googleAuthUrl, googleConfigured, googleProfile } from './google';

const secureCookies = () => (process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production');
const cookieOpts = (maxAge?: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Secure by default in production; COOKIE_SECURE=false allows plain http://localhost (local containers).
  secure: secureCookies(),
  path: '/',
  maxAge,
});

/** Google round trip: state, nonce, device and where to go next, for 10 minutes. */
const OAUTH_COOKIE = 'ananda_oauth';
const oauthCookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: secureCookies(), path: '/api/auth/google', maxAge: 10 * 60_000 };

const meta = (req: Request) => ({ userAgent: req.header('user-agent'), ip: req.ip });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Which sign-in methods this server offers (Google only once its keys are set). */
  @Public()
  @Get('methods')
  methods() {
    return { link: true, google: googleConfigured() };
  }

  @Public()
  @Post('link')
  @HttpCode(200)
  link(@Body(new ZodPipe(signInLinkSchema)) body: z.infer<typeof signInLinkSchema>, @Req() req: Request) {
    return this.auth.requestLink(body.email, body.next, meta(req));
  }

  @Public()
  @Post('link/verify')
  @HttpCode(200)
  async verifyLink(@Body(new ZodPipe(verifyLinkSchema)) body: z.infer<typeof verifyLinkSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.verifyLink(body.token, body.device, meta(req));
    res.cookie(SESSION_COOKIE, r.token, cookieOpts(r.maxAgeMs));
    return { twoStep: r.twoStep };
  }

  @Public()
  @Get('google')
  google(@Query('device') device: string, @Query('next') next: string | undefined, @Query('email') email: string | undefined, @Res() res: Response) {
    if (!googleConfigured()) return res.redirect(`${webOrigin()}/login?error=google_off`);
    const state = randomToken(16);
    const nonce = randomToken(16);
    const value = Buffer.from(JSON.stringify({ state, nonce, device: device === 'phone' ? 'phone' : 'desktop', next: safeNext(next) })).toString('base64url');
    res.cookie(OAUTH_COOKIE, value, oauthCookieOpts);
    return res.redirect(googleAuthUrl(state, nonce, email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined));
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Req() req: Request, @Res() res: Response) {
    const back = (reason: string) => res.redirect(`${webOrigin()}/login?error=${reason}`);
    let saved: { state: string; nonce: string; device: 'desktop' | 'phone'; next?: string } | null = null;
    try {
      saved = JSON.parse(Buffer.from(String(req.cookies?.[OAUTH_COOKIE] ?? ''), 'base64url').toString('utf8'));
    } catch {
      saved = null;
    }
    res.clearCookie(OAUTH_COOKIE, { ...oauthCookieOpts, maxAge: undefined });
    if (error) return back('google_cancelled');
    if (!code || !saved || !state || saved.state !== state) return back('google_failed');
    const profile = await googleProfile(code, saved.nonce).catch(() => null);
    if (!profile) return back('google_failed');
    const user = await this.auth.googleUser(profile, meta(req));
    if (!user) return back('no_account');
    const r = await this.auth.startSession(user.id, saved.device, 'google', meta(req));
    res.cookie(SESSION_COOKIE, r.token, cookieOpts(r.maxAgeMs));
    const q = new URLSearchParams({ twoStep: r.twoStep });
    if (saved.next) q.set('next', saved.next);
    if (user.invited) q.set('invited', '1');
    return res.redirect(`${webOrigin()}/login/done?${q}`);
  }

  @BeforeTwoStep()
  @AllowInPreview()
  @Post('logout')
  @HttpCode(200)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth);
    res.clearCookie(SESSION_COOKIE, cookieOpts());
    return { ok: true };
  }

  @BeforeTwoStep()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @BeforeTwoStep()
  @Post('two-step/setup')
  twoStepSetup(@Auth() auth: AuthContext) {
    return this.auth.twoStepSetup(auth);
  }

  @BeforeTwoStep()
  @Post('two-step/verify')
  @HttpCode(200)
  twoStepVerify(@Auth() auth: AuthContext, @Body(new ZodPipe(twoStepSchema)) body: { code: string }) {
    return this.auth.twoStepVerify(auth, body.code);
  }

  @Public()
  @Get('invite/:token')
  inviteInfo(@Param('token') token: string) {
    return this.auth.inviteInfo(token);
  }

  @Public()
  @Post('invite/accept')
  @HttpCode(200)
  async acceptInvite(@Body(new ZodPipe(acceptInviteSchema)) body: z.infer<typeof acceptInviteSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.acceptInvite(body.token, body.device, meta(req));
    res.cookie(SESSION_COOKIE, r.token, cookieOpts(r.maxAgeMs));
    return { twoStep: r.twoStep };
  }

  @Get('sessions')
  sessions(@Auth() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:id')
  revoke(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.auth.revokeSession(auth, id === 'others' ? 'others' : id);
  }

  @AllowInPreview()
  @Patch('profile')
  async profile(@Auth() auth: AuthContext, @Body(new ZodPipe(profileSchema)) body: z.infer<typeof profileSchema>) {
    await this.auth.updateProfile(auth, body);
    return { ok: true };
  }

  @AllowInPreview()
  @Post('preview')
  @HttpCode(200)
  async preview(@Auth() auth: AuthContext, @Body(new ZodPipe(z.object({ roleId: z.string().uuid().nullable() }))) body: { roleId: string | null }) {
    await this.auth.preview(auth, body.roleId);
    return { ok: true };
  }
}
