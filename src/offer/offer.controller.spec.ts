import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfferController } from './offer.controller'

const service = { findOne: vi.fn(), create: vi.fn(), publish: vi.fn(), close: vi.fn() }

// E3-01 (H-4 y H-5): la identidad de quien llama sale del token, nunca del cuerpo ni de la ruta. Si el
// controlador dejara de pasarla, el servicio no podría comprobar la pertenencia ni la visibilidad.
describe('OfferController — identidad del solicitante', () => {
  let controller: OfferController
  const req = { user: { sub: 50, role: Role.COMPANY } }

  beforeEach(() => {
    vi.resetAllMocks()
    controller = new OfferController(service as never)
  })

  it('findOne entrega al servicio el id y el rol del token', () => {
    controller.findOne(4, req)

    expect(service.findOne).toHaveBeenCalledWith(4, 50, Role.COMPANY)
  })

  it('create entrega al servicio el id y el rol del token', () => {
    const dto = { companyId: 5 } as never

    controller.create(dto, req)

    expect(service.create).toHaveBeenCalledWith(dto, 50, Role.COMPANY)
  })

  it('publish entrega al servicio el id y el rol del token', () => {
    controller.publish(4, req)

    expect(service.publish).toHaveBeenCalledWith(4, 50, Role.COMPANY)
  })

  it('close entrega al servicio el id y el rol del token', () => {
    controller.close(4, req)

    expect(service.close).toHaveBeenCalledWith(4, 50, Role.COMPANY)
  })
})
