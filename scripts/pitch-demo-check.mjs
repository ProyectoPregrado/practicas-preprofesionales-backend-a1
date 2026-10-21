import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import process from 'node:process'

// Solo lectura. Ejecutar sobre la base de demo preparada con el seed, nunca la modifica.
const dateText = process.argv[2] ?? '2026-04-30'
const date = new Date(`${dateText}T00:00:00Z`)
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
  throw new Error('La fecha debe ser un día válido con formato AAAA-MM-DD')
}
const prisma = new PrismaClient()
try {
  const accounts = await prisma.user.findMany({
    where: { email: { in: ['estudiante0@miyura.com', 'tutor0@miyura.com', 'empresa0@miyura.com', 'coordinador@miyura.com'] } },
    select: { id: true, email: true, role: true, companyId: true },
  })
  const student = accounts.find((account) => account.role === 'STUDENT')
  const tutor = accounts.find((account) => account.role === 'TUTOR')
  const company = accounts.find((account) => account.role === 'COMPANY')
  if (!student || !tutor || !company || !accounts.some((account) => account.role === 'COORDINATOR')) {
    throw new Error('Faltan cuentas de demo: prepara una base nueva con prisma/seed.ts')
  }
  const placement = await prisma.placement.findFirst({
    where: { studentId: student.id, status: 'ACTIVE', deletedAt: null },
    select: { id: true, tutorId: true, companyId: true, requiredHours: true, startDate: true, endDate: true },
  })
  if (!placement || placement.tutorId !== tutor.id || placement.companyId !== company.companyId) {
    throw new Error('La plaza activa no coincide con el estudiante, tutor y empresa del guion')
  }
  if (date < placement.startDate || date > placement.endDate) throw new Error('El día elegido debe pertenecer a la práctica')
  const [students, placements, hourLogs, approved, onDemoDate] = await Promise.all([
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.placement.count({ where: { deletedAt: null } }),
    prisma.hourLog.count({ where: { deletedAt: null } }),
    prisma.hourLog.aggregate({ where: { placementId: placement.id, status: 'APPROVED', deletedAt: null }, _sum: { hours: true } }),
    prisma.hourLog.count({ where: { placementId: placement.id, date: { gte: date, lt: new Date(date.getTime() + 86_400_000) }, deletedAt: null } }),
  ])
  const evidence = {
    measuredAt: new Date().toISOString(), students, placements, hourLogs,
    demo: { placementId: placement.id, date: dateText, requiredHours: placement.requiredHours, approvedHoursBefore: approved._sum.hours ?? 0, recordsOnDate: onDemoDate },
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n')
  if (onDemoDate !== 0) throw new Error('La fecha ya tiene registros: elige otra fecha libre antes del ensayo')
} finally {
  await prisma.$disconnect()
}
