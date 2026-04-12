import { Module } from '@nestjs/common';
import { AuthService } from '@uv/auth-core';
import { AuthJsService } from './auth-js.service';

@Module({
  providers: [{ provide: AuthService, useClass: AuthJsService }],
  exports: [AuthService],
})
export class AuthModule {}
