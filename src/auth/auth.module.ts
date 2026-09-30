import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RolesGuard } from './guards/roles.guard'
import { getRequiredJwtSecret } from './jwt-secret'

@Module({
  imports: [
    JwtModule.register({
      global: true,
      // E3-04: sin fallback. Si falta JWT_SECRET, getRequiredJwtSecret() lanza
      // al cargar este módulo y la aplicación no arranca (cierra D-07).
      secret: getRequiredJwtSecret(),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
