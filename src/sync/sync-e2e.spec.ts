import 'dotenv/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('SyncController (e2e) - E1-04 Integración', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testUserId = 1;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('/sync/push (POST) - rechaza edición offline de hora APPROVED', async () => {
    // 1. Buscamos una práctica existente o la creamos si la base de datos está vacía (CI)
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
        where: { taxId: 'TAX-E2E-AUTO-01' },
        update: {},
        create: {
          taxId: 'TAX-E2E-AUTO-01',
          name: 'Empresa E2E Test',
          sector: 'Tecnología',
          contactEmail: 'empresa_e2e@miyura.com',
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

    // 2. Asociamos el usuario autenticado como dueño de la práctica
    testUserId = placement.studentId || 1;

    // 3. Creamos una hora previamente aprobada
    const testLog = await prisma.hourLog.create({
      data: {
        date: new Date('2026-09-22'),
        startTime: '08:00',
        endTime: '12:00',
        hours: 4,
        activity: 'Registro de horas aprobado en servidor',
        status: 'APPROVED',
        placementId: placement.id,
      },
    });

    const clientOpId = `e2e-op-${Date.now()}`;

    // 4. Intentamos modificar la hora desde offline
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
              id: testLog.id,
              activity: 'Intento de modificación offline sobre hora aprobada',
            },
          },
        ],
      });

    // 5. Validaciones de la regla E1-04
    expect(response.status).toBe(201);
    expect(response.body.results[0].status).toBe('rejected');
    expect(response.body.results[0].server.status).toBe('APPROVED');

    // 6. Limpieza puntual de datos del test
    await prisma.hourLog.delete({ where: { id: testLog.id } }).catch(() => {});
    await prisma.syncOperation.delete({ where: { clientOpId } }).catch(() => {});
  });
});