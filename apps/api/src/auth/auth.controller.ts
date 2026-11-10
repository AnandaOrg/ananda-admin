import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { acceptInviteSchema, changePasswordSchema, loginSchema, profileSchema, twoStepSchema } from '@ananda/shared';
import { AllowInPreview, Auth, BeforeTwoStep, Public, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { SESSION_COOKIE } from '../common/auth.guard';
import { AuthService } from './auth.service';

const cookieOpts = (maxAge?: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Secure by default in production; COOKIE_SECURE=false allows plain http://localhost (local containers).
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body, { userAgent: req.header('user-agent'), ip: req.ip });
    res.cookie(SESSION_COOKIE, r.token, cookieOpts(r.maxAgeMs));
    return { twoStep: r.twoStep };
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
  acceptInvite(@Body(new ZodPipe(acceptInviteSchema)) body: { token: string; password: string }) {
    return this.auth.acceptInvite(body.token, body.password);
  }

  @Get('sessions')
  sessions(@Auth() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:id')
  revoke(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.auth.revokeSession(auth, id === 'others' ? 'others' : id);
  }

  @Post('password')
  @HttpCode(200)
  async password(@Auth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(auth, body.current, body.next, req.header('x-two-step-code'), body.signOutOthers);
    return { ok: true };
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
