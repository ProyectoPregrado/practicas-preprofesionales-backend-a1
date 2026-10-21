import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type INestApplication, ValidationPipe } from '@nestjs/common'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { DocumentKind, PlacementStatus, Role } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpExceptionFilter } from '../common/http-exception.filter'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { createPostgresTestDatabase, postgresTestUrl } from '../test/postgres-database'
import { DocumentModule } from './document.module'

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')

describe.skipIf(!postgresTestUrl)('DOC-1: subir y ver el archivo de un documento', () => {
  let database: Awaited<ReturnType<typeof createPostgresTestDatabase>>
  let app: INestApplication
  let jwt: JwtService
  let dir: string
  let previousUploadDir: string | undefined
  let studentId: number
  let otherStudentId: number
  let tutorId: number
  let otherTutorId: number
  let placementId: number

  const tokenFor = (sub: number, role: Role) => jwt.sign({ sub, role })

  beforeAll(async () => {
    previousUploadDir = process.env.UPLOAD_DIR
    dir = await mkdtemp(join(tmpdir(), 'doc-1-'))
    process.env.UPLOAD_DIR = dir

    database = await createPostgresTestDatabase()
    const module = await Test.createTestingModule({
      imports: [PrismaModule, DocumentModule, JwtModule.register({ global: true, secret: 'doc-1-test-secret' })],
    }).overrideProvider(PrismaService).useValue(database.prisma).compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.init()
    jwt = module.get(JwtService)

    const user = (role: Role) =>
      database.prisma.user.create({
        data: { email: `${randomUUID()}@test.invalid`, fullName: 'Persona', password: randomUUID(), role },
      })
    ;[studentId, otherStudentId, tutorId, otherTutorId] = (
      await Promise.all([user(Role.STUDENT), user(Role.STUDENT), user(Role.TUTOR), user(Role.TUTOR)])
    ).map((created) => created.id)

    const company = await database.prisma.company.create({
      data: { taxId: 'DOC-1', name: 'Empresa', sector: 'Software', contactEmail: 'empresa@test.invalid' },
    })
    const offer = await database.prisma.offer.create({
      data: {
        companyId: company.id, title: 'Oferta', description: 'Prueba', modality: 'REMOTE', seats: 1,
        requiredHours: 240, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-12-31'),
      },
    })
    const application = await database.prisma.application.create({
      data: { offerId: offer.id, studentId, motivation: 'Prueba', status: 'ACCEPTED' },
    })
    const placement = await database.prisma.placement.create({
      data: {
        applicationId: application.id, studentId, tutorId, companyId: company.id, requiredHours: 240,
        startDate: new Date('2026-03-01'), endDate: new Date('2026-07-31'), status: PlacementStatus.PENDING_DOCS,
      },
    })
    placementId = placement.id
  }, 90_000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
    await rm(dir, { recursive: true, force: true })
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR
    else process.env.UPLOAD_DIR = previousUploadDir
  })

  function upload(token: string, file: Buffer, filename: string, kind: string = DocumentKind.AGREEMENT) {
    return request(app.getHttpServer())
      .post(`/api/placements/${placementId}/documents/upload`)
      .auth(token, { type: 'bearer' })
      .field('kind', kind)
      .attach('file', file, { filename, contentType: 'application/pdf' })
  }

  it('el estudiante sube un PDF: queda pendiente, con el tipo del contenido y una clave del servidor', async () => {
    const response = await upload(tokenFor(studentId, Role.STUDENT), PDF, 'Convenio firmado.pdf')

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      placementId, kind: 'AGREEMENT', filename: 'Convenio firmado.pdf', mimeType: 'application/pdf',
      size: PDF.length, status: 'PENDING', uploadedById: studentId,
    })
    expect(response.body.storageKey).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(await readdir(dir)).toContain(response.body.storageKey)
  })

  it('rechaza un archivo que no es PDF ni imagen aunque se llame .pdf, y no lo guarda', async () => {
    const before = await readdir(dir)
    const response = await upload(tokenFor(studentId, Role.STUDENT), Buffer.from('MZ ejecutable'), 'convenio.pdf')

    expect(response.status).toBe(400)
    expect(response.body.message).toBe('solo se aceptan PDF, PNG o JPG')
    expect(await readdir(dir)).toEqual(before)
  })

  it('rechaza un archivo de más de 10 MB con 413', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)])
    const response = await upload(tokenFor(studentId, Role.STUDENT), big, 'enorme.pdf')

    expect(response.status).toBe(413)
  })

  it('otro estudiante no puede subir a esta plaza, ni un tipo de documento inventado', async () => {
    expect((await upload(tokenFor(otherStudentId, Role.STUDENT), PDF, 'x.pdf')).status).toBe(403)
    expect((await upload(tokenFor(studentId, Role.STUDENT), PDF, 'x.pdf', 'DIPLOMA')).status).toBe(400)
  })

  it('el estudiante, su tutor y la coordinación ven el archivo; otro tutor u otro estudiante no', async () => {
    const created = await upload(tokenFor(studentId, Role.STUDENT), PDF, 'Seguro médico.pdf', DocumentKind.INSURANCE)
    const get = (token: string) =>
      request(app.getHttpServer()).get(`/api/documents/${created.body.id}/file`).auth(token, { type: 'bearer' }).buffer(true)

    for (const token of [tokenFor(studentId, Role.STUDENT), tokenFor(tutorId, Role.TUTOR), tokenFor(999, Role.COORDINATOR)]) {
      const response = await get(token)
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['content-disposition']).toContain("filename*=UTF-8''Seguro%20m%C3%A9dico.pdf")
      expect(Buffer.from(response.body).equals(PDF)).toBe(true)
    }
    expect((await get(tokenFor(otherTutorId, Role.TUTOR))).status).toBe(403)
    expect((await get(tokenFor(otherStudentId, Role.STUDENT))).status).toBe(403)
  })

  it('un documento registrado antes de DOC-1 responde 404 explicando que no tiene archivo, también si su clave intenta salir de la carpeta', async () => {
    for (const storageKey of ['convenio.pdf', '../../.env']) {
      const legacy = await database.prisma.document.create({
        data: {
          placementId, kind: DocumentKind.REPORT, filename: 'informe.pdf', mimeType: 'application/pdf', size: 1,
          storageKey, uploadedById: studentId,
        },
      })
      const response = await request(app.getHttpServer())
        .get(`/api/documents/${legacy.id}/file`)
        .auth(tokenFor(studentId, Role.STUDENT), { type: 'bearer' })

      expect(response.status).toBe(404)
      expect(response.body.message).toBe('este documento se registró sin archivo; hay que volver a subirlo')
    }
  })

  it('¿y si se sube dos veces al mismo tiempo? Quedan dos documentos con dos archivos distintos, sin pisarse', async () => {
    const token = tokenFor(studentId, Role.STUDENT)
    const [a, b] = await Promise.all([upload(token, PDF, 'a.pdf', DocumentKind.EVIDENCE), upload(token, PDF, 'b.pdf', DocumentKind.EVIDENCE)])

    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.body.storageKey).not.toBe(b.body.storageKey)
    expect(a.body.id).not.toBe(b.body.id)
  })
})
