import 'dotenv/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { describe, beforeAll, afterAll, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('SyncController (e2e) - E1-04 Integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testUserId = 1;
  let placementId: number;

  // Helper: asegura que existe un placement de prueba y devuelve su ID
  async function ensurePlacement(): Promise<number> {
    let placement = (await prisma.placement.findFirst()) as any;

    if (!placement) {
      const student = await prisma.user.upsert({
        where: { email: 'student_e2e@miyura.com' },
        update: {},
        create: {
          email: 'student_e2e@miyura.com',
          password: 'hashedpassword123',
          fullName: 'Estudiante E2E Test',
          role: 'STUDENT',
        },
      });

      const tutor = await prisma.user.upsert({
        where: { email: 'tutor_e2e@miyura.com' },
        update: {},
        create: {
          email: 'tutor_e2e@miyura.com',
          password: 'hashedpassword123',
          fullName: 'Tutor E2E Test',
          role: 'TUTOR',
        },
      });

      const company = await prisma.company.upsert({
        where: { taxId: 'TAX-E2E-AUTO-02' },
        update: {},
        create: {
          taxId: 'TAX-E2E-AUTO-02',
          name: 'Empresa E2E Test',
          sector: 'Tecnología',
          contactEmail: 'empresa_e2e_02@miyura.com',
          verified: true,
        },
      });

      const offer = await prisma.offer.create({
        data: {
          companyId: company.id,
          title: 'Práctica Desarrollo E2E',
          description: 'Descripción para test E2E',
          modality: 'Presencial',
          seats: 1,
          requiredHours: 240,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
        },
      });

      const application = await prisma.application.create({
        data: {
          offerId: offer.id,
          studentId: student.id,
          motivation: 'Postulación para prueba E2E',
        },
      });

      placement = await prisma.placement.create({
        data: {
          applicationId: application.id,
          studentId: student.id,
          tutorId: tutor.id,
          companyId: company.id,
          startDate: new Date(),
          endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
          requiredHours: 240,
          status: 'ACTIVE',
        },
      });
    }

    testUserId = placement.studentId || 1;
    return placement.id;
  }

  // Helper: crea un hourLog y devuelve su ID
  async function createHourLog(
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
    placementId: number,
  ): Promise<number> {
    const log = await prisma.hourLog.create({
      data: {
        date: new Date('2026-09-22'),
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: `Hora en estado ${status} para test E1-04`,
        status,
        placementId,
      },
    });
    return log.id;
  }

  // Helper: cleanup
  async function cleanup(clientOpId: string, hourLogId?: number) {
    if (hourLogId) {
      await prisma.hourLog.delete({ where: { id: hourLogId } }).catch(() => {});
    }
    await prisma.syncOperation.delete({ where: { clientOpId } }).catch(() => {});
  }

  beforeAll(async () => {
    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = {
              id: testUserId,
              sub: testUserId,
              userId: testUserId,
              email: 'student_e2e@miyura.com',
              role: 'STUDENT',
            };
            return true;
          },
        })
        .compile();

      app = moduleFixture.createNestApplication();
      prisma = app.get<PrismaService>(PrismaService);
      await app.init();
      placementId = await ensurePlacement();
    } catch (error) {
      // Si PostgreSQL no está disponible (Docker apagado), los tests se saltan
      console.warn('E2E tests skipped: PostgreSQL not available. Start with `docker-compose up -d`');
    }
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/sync/push (POST) - E1-04 rechaza edición offline de hora APPROVED', async () => {
    if (!prisma) return; // skip si no hay DB

    const hourLogId = await createHourLog('APPROVED', placementId);
    const clientOpId = `e2e-approved-${Date.now()}`;

    const response = await request(app.getHttpServer())
      .post('/sync/push')
      .send({
        ops: [
          {
            clientOpId,
            entity: 'hourLog',
            op: 'update',
            baseVersion: 1,
            payload: {
              id: hourLogId,
              activity: 'Intento de modificación offline sobre hora aprobada',
            },
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.results[0].status).toBe('rejected');
    expect(response.body.results[0].server.status).toBe('APPROVED');
    expect(response.body.results[0].reason).toContain('APPROVED');

    await cleanup(clientOpId, hourLogId);
  });

  it('/sync/push (POST) - E1-04 rechaza edición offline de hora REJECTED', async () => {
    if (!prisma) return;

    const hourLogId = await createHourLog('REJECTED', placementId);
    const clientOpId = `e2e-rejected-${Date.now()}`;

    const response = await request(app.getHttpServer())
      .post('/sync/push')
      .send({
        ops: [
          {
            clientOpId,
            entity: 'hourLog',
            op: 'update',
            baseVersion: 1,
            payload: {
              id: hourLogId,
              activity: 'Intento de modificación offline sobre hora rechazada',
            },
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.results[0].status).toBe('rejected');
    expect(response.body.results[0].server.status).toBe('REJECTED');
    expect(response.body.results[0].reason).toContain('REJECTED');

    await cleanup(clientOpId, hourLogId);
  });

  it('/sync/push (POST) - E1-04 rechaza DELETE de hora APPROVED', async () => {
    if (!prisma) return;

    const hourLogId = await createHourLog('APPROVED', placementId);
    const clientOpId = `e2e-delete-approved-${Date.now()}`;

    const response = await request(app.getHttpServer())
      .post('/sync/push')
      .send({
        ops: [
          {
            clientOpId,
            entity: 'hourLog',
            op: 'delete',
            baseVersion: 1,
            payload: { id: hourLogId },
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.results[0].status).toBe('rejected');
    expect(response.body.results[0].server.status).toBe('APPROVED');
    expect(response.body.results[0].reason).toContain('APPROVED');

    await cleanup(clientOpId, hourLogId);
  });

  it('/sync/push (POST) - E1-04 permite edición en DRAFT', async () => {
    if (!prisma) return;

    const hourLogId = await createHourLog('DRAFT', placementId);
    const clientOpId = `e2e-draft-${Date.now()}`;

    const response = await request(app.getHttpServer())
      .post('/sync/push')
      .send({
        ops: [
          {
            clientOpId,
            entity: 'hourLog',
            op: 'update',
            baseVersion: 1,
            payload: {
              id: hourLogId,
              date: '2026-09-22',
              startTime: '08:00',
              endTime: '12:00',
              hours: 4,
              activity: 'Edición válida en DRAFT',
            },
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.results[0].status).toBe('applied');

    await cleanup(clientOpId, hourLogId);
  });

  it('/sync/push (POST) - E1-04 permite edición en SUBMITTED', async () => {
    if (!prisma) return;

    const hourLogId = await createHourLog('SUBMITTED', placementId);
    const clientOpId = `e2e-submitted-${Date.now()}`;

    const response = await request(app.getHttpServer())
      .post('/sync/push')
      .send({
        ops: [
          {
            clientOpId,
            entity: 'hourLog',
            op: 'update',
            baseVersion: 1,
            payload: {
              id: hourLogId,
              date: '2026-09-22',
              startTime: '08:00',
              endTime: '12:00',
              hours: 4,
              activity: 'Edición válida en SUBMITTED',
            },
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.results[0].status).toBe('applied');

    await cleanup(clientOpId, hourLogId);
  });
});
