import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password)
  }

  // E3-03: renovar la sesión sin volver a pedir credenciales.
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken)
  }

  // T-2: cerrar sesión revoca el refresh token en el servidor.
  @Post('logout')
  @HttpCode(204)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken)
  }
}
