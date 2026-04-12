import { Module } from '@nestjs/common';
import { AuthService } from '@uv/auth-core';
import { AuthController } from './auth.controller';
import { AuthJsService } from './auth-js.service';

@Module({
  controllers: [AuthController],
  providers: [{ provide: AuthService, useClass: AuthJsService }],
  exports: [AuthService],
})
export class AuthModule {}
