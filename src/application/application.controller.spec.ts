import { ApplicationStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationController } from './application.controller'

const service = { listByOffer: vi.fn(), decide: vi.fn() }

// E3-07: la identidad de quien llama sale del token, nunca del cuerpo ni de la ruta. Si el
// controlador dejara de pasarla, el servicio no podría comprobar la pertenencia.
describe('ApplicationController — identidad del solicitante (E3-07)', () => {
  let controller: ApplicationController
  const req = { user: { sub: 50, role: Role.COMPANY } }

  beforeEach(() => {
    vi.resetAllMocks()
    controller = new ApplicationController(service as never)
  })

  it('listByOffer entrega al servicio el id y el rol del token', () => {
    controller.listByOffer(4, req)

    expect(service.listByOffer).toHaveBeenCalledWith(4, 50, Role.COMPANY)
  })

  it('decide entrega al servicio el id y el rol del token', () => {
    controller.decide(7, { status: ApplicationStatus.REJECTED }, req)

    expect(service.decide).toHaveBeenCalledWith(7, ApplicationStatus.REJECTED, 50, Role.COMPANY)
  })
})
