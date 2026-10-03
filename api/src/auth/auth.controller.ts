import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';

const authLimit = () => ({ default: { limit: Number(process.env.THROTTLE_AUTH_PER_MINUTE ?? 10), ttl: 60_000 } });

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(authLimit())
  @ApiOperation({ summary: 'Créer un compte client' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(authLimit())
  @ApiOperation({ summary: 'Se connecter (verrouillage après 5 échecs en 15 min)' })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renouveler la session (jeton rotatif)' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle(authLimit())
  @ApiOperation({ summary: 'Envoyer un lien de réinitialisation (réponse identique si le compte existe ou non)' })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Si un compte existe pour cette adresse, un e-mail vient d’être envoyé.' };
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle(authLimit())
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }
}
