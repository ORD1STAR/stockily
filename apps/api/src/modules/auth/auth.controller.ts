import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { CurrentUser, AuthenticatedUser } from '../tenancy/decorators/current-user.decorator';
import { JwtAuthGuard } from '../tenancy/guards/jwt-auth.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audit } from '../audit/audit.decorator';

// Stricter than the global default (main app.module.ts) on the three
// routes that are actual brute-force/credential-stuffing targets — the
// global limit alone is generous enough for normal API usage that it
// wouldn't meaningfully slow down a password-guessing script.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Throttle(AUTH_THROTTLE)
  @UseInterceptors(AuditInterceptor)
  @Audit('organization', 'organization.created')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
  }

  // Authenticated (not just "holds a refresh token") — revokes every
  // session for the caller, not just the one they're currently using.
  @Post('logout-everywhere')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutEverywhere(@CurrentUser() authUser: AuthenticatedUser) {
    await this.authService.logoutEverywhere(authUser.userId);
  }
}
