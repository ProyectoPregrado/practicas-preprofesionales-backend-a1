import type { Prisma } from '@prisma/client'

// H-6 (T-4): lo que cualquier usuario autenticado puede ver de una empresa.
// `taxId` y `contactEmail` quedan solo para la coordinación.
export const PUBLIC_COMPANY_SELECT = {
  id: true,
  name: true,
  sector: true,
  verified: true,
  createdAt: true,
} satisfies Prisma.CompanySelect
