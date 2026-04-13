import { Module } from '@nestjs/common';
import { AuthService } from '@uv/auth-core';

import { AuthController } from './auth.controller';
import { LocalAuthService } from './local-auth.service';

@Module({
  controllers: [AuthController],
  providers: [{ provide: AuthService, useClass: LocalAuthService }],
  exports: [AuthService],
})
export class AuthModule {}
