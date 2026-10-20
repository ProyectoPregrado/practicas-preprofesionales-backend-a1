import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { OfferStatus, PlacementStatus, PrismaClient, Role } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatDay, normalizeCalendarDay } from '../common/calendar-date'
import { TIME_ZONES, useTimeZone } from '../test/time-zone'
import { HourLogService } from './hour-log.service'

// E6-02: el rango de la práctica y la fecha futura se hacen cumplir contra Postgres real. La plaza abarca
// de marzo de 2026 a 2099, así que «dentro del rango» no caduca; lo que se prueba es lo que queda en la base.
const prisma = new PrismaClient()
const suffix = `${Date.now()}`
const service = new HourLogService(prisma as never)
const created = { userIds: [] as number[], placementId: 0, applicationId: 0, offerId: 0, companyId: 0 }
let studentId = 0
let placementId = 0

const dto = (date: unknown, hours = 2) => ({
  placementId,
  date: normalizeCalendarDay(date),
  startTime: '08:00',
  endTime: '10:00',
  hours,
  activity: 'Actividad de prueba E6-02',
})

const storedDays = async () =>
  (await prisma.hourLog.findMany({ where: { placementId }, orderBy: { date: 'asc' } })).map((row) => formatDay(row.date))

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { taxId: `E602${suffix}`, name: `Empresa E6-02 ${suffix}`, sector: 'TI', contactEmail: `e602-${suffix}@test.local` },
  })
  created.companyId = company.id
  const [student, tutor] = await Promise.all(
    ['student', 'tutor'].map((kind) =>
      prisma.user.create({
        data: {
          email: `e602-${kind}-${suffix}@test.local`,
          password: randomUUID(),
          fullName: kind,
          role: kind === 'tutor' ? Role.TUTOR : Role.STUDENT,
        },
      }),
    ),
  )
  created.userIds.push(student.id, tutor.id)
  studentId = student.id
  const offer = await prisma.offer.create({
    data: {
      companyId: company.id,
      title: `E6-02 ${suffix}`,
      description: 'x',
      modality: 'PRESENCIAL',
      seats: 1,
      requiredHours: 240,
      periodStart: new Date('2026-03-01'),
      periodEnd: new Date('2099-12-31'),
      status: OfferStatus.PUBLISHED,
    },
  })
  created.offerId = offer.id
  const application = await prisma.application.create({
    data: { offerId: offer.id, studentId: student.id, motivation: 'Prueba E6-02 del rango de fechas', status: 'ACCEPTED' },
  })
  created.applicationId = application.id
  const placement = await prisma.placement.create({
    data: {
      applicationId: application.id,
      studentId: student.id,
      tutorId: tutor.id,
      companyId: company.id,
      startDate: new Date('2026-03-01'),
      endDate: new Date('2099-12-31'),
      requiredHours: 240,
      status: PlacementStatus.ACTIVE,
    },
  })
  created.placementId = placement.id
  placementId = placement.id
})

afterAll(async () => {
  await prisma.hourLog.deleteMany({ where: { placementId: created.placementId } })
  await prisma.placement.deleteMany({ where: { id: created.placementId } })
  await prisma.application.deleteMany({ where: { id: created.applicationId } })
  await prisma.offer.deleteMany({ where: { id: created.offerId } })
  await prisma.company.deleteMany({ where: { id: created.companyId } })
  await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
  await prisma.$disconnect()
})

describe.each(TIME_ZONES)('fecha del registro de horas (E6-02, Postgres real), zona del servidor %s', (zone) => {
  useTimeZone(zone)

  it('rechaza una fecha anterior a la práctica, con el rango válido, y no deja nada en la base', async () => {
    await expect(service.create(dto('2026-02-28'), studentId)).rejects.toThrow(
      'la fecha debe estar entre 2026-03-01 y 2099-12-31, los días de la práctica',
    )

    expect(await storedDays()).not.toContain('2026-02-28')
  })

  it('rechaza una fecha futura y no deja nada en la base', async () => {
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await expect(service.create(dto(tomorrow), studentId)).rejects.toThrow(BadRequestException)

    expect(await storedDays()).not.toContain(tomorrow)
  })

  it('guarda el día normalizado: el mismo instante desde tres dispositivos da el mismo día', async () => {
    const date = '2026-04-02'
    for (const [i, instant] of ['2026-04-02T15:00:00Z', '2026-04-02T10:00:00-05:00', '2026-04-03T04:00:00+13:00'].entries()) {
      await service.create({ ...dto(instant, 2), startTime: `0${i + 1}:00`, endTime: `0${i + 2}:00` }, studentId)
    }

    const rows = await prisma.hourLog.findMany({ where: { placementId, date: new Date(date) } })
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => formatDay(row.date) === date)).toBe(true)
    await prisma.hourLog.deleteMany({ where: { placementId, date: new Date(date) } })
  })
})
