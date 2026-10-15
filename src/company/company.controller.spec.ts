import { Role } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { CompanyController } from './company.controller'

describe('CompanyController', () => {
  it('pasa el rol del token al servicio al listar', () => {
    const service = { findAll: vi.fn().mockReturnValue([]) }
    const controller = new CompanyController(service as never)

    controller.findAll({ user: { role: Role.STUDENT } })

    expect(service.findAll).toHaveBeenCalledWith(Role.STUDENT)
  })
})
