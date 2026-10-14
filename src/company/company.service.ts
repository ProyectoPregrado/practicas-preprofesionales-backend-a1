import { Injectable } from '@nestjs/common'
import { Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PUBLIC_COMPANY_SELECT } from './company.select'
import type { CreateCompanyDto } from './dto/create-company.dto'

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCompanyDto) {
    return this.prisma.company.create({ data: dto })
  }

  // H-6: el catálogo solo necesita nombre y sector; el NIT y el correo de contacto
  // los ve únicamente la coordinación. El filtro vive acá para que el servicio no
  // dependa de que el controlador lo recuerde.
  findAll(role: Role) {
    if (role === Role.COORDINATOR) return this.prisma.company.findMany()
    return this.prisma.company.findMany({ select: PUBLIC_COMPANY_SELECT })
  }
}
