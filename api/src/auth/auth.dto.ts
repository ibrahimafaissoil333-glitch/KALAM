import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from '../common/util.js';

export class DeviceDto {
  @ApiPropertyOptional({ description: "Identifiant stable de l'appareil (généré par l'app)" })
  @IsOptional() @IsString() @MaxLength(100)
  deviceKey?: string;

  @ApiPropertyOptional({ example: 'iPhone de Sarah' })
  @IsOptional() @IsString() @MaxLength(100)
  deviceLabel?: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsOptional() @IsIn(['ios', 'android', 'web'])
  platform?: string;
}

export class RegisterDto extends DeviceDto {
  @ApiProperty({ example: 'Sarah' })
  @IsString() @MinLength(1, { message: 'Indiquez un prénom ou un pseudonyme.' }) @MaxLength(80)
  name: string;

  @ApiProperty({ example: 'sarah@exemple.fr' })
  @IsEmail({}, { message: 'Saisissez une adresse e-mail valide.' }) @MaxLength(254)
  email: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  password: string;

  @ApiProperty({ description: 'Acceptation des CGU et de la politique de confidentialité (obligatoire)' })
  @IsBoolean()
  acceptTerms: boolean;

  @ApiPropertyOptional({ description: 'Consentement aux e-mails de nouveautés (facultatif)' })
  @IsOptional() @IsBoolean()
  marketingConsent?: boolean;
}

export class LoginDto extends DeviceDto {
  @ApiProperty() @IsEmail({}, { message: 'Saisissez une adresse e-mail valide.' })
  email: string;

  @ApiProperty() @IsString() @MinLength(1, { message: 'Saisissez votre mot de passe.' }) @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MaxLength(200)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail({}, { message: 'Saisissez une adresse e-mail valide.' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MaxLength(200)
  token: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  password: string;
}
