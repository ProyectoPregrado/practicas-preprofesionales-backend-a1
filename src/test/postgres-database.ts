import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

export const postgresTestUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL

// Each suite migrates its own schema; existing application data is never reset.
export async function createPostgresTestDatabase() {
  if (!postgresTestUrl) throw new Error('Set TEST_DATABASE_URL to run PostgreSQL integration tests')
  const schema = `test_${randomUUID().replaceAll('-', '')}`
  const url = new URL(postgresTestUrl)
  url.searchParams.set('schema', schema)
  const admin = new PrismaClient({ datasources: { db: { url: postgresTestUrl } } })
  const prisma = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: [{ emit: 'event', level: 'query' }],
  })
  let schemaCreated = false
  const queries: string[] = []
  prisma.$on('query', (event) => queries.push(event.query))

  const close = async () => {
    await prisma.$disconnect()
    try {
      if (schemaCreated) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    } finally {
      await admin.$disconnect()
    }
  }

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    schemaCreated = true
    const migration = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      encoding: 'utf8',
      timeout: 60_000,
    })
    if (migration.error) throw migration.error
    if (migration.status !== 0) throw new Error(`Test migrations failed: ${migration.stdout}\n${migration.stderr}`)
    await prisma.$connect()
    return { prisma, queries, close }
  } catch (error) {
    await close()
    throw error
  }
}
