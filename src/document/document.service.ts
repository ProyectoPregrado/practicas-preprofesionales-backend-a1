import { createReadStream } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common'
import { DocumentKind, DocumentStatus, Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  MAX_DOCUMENT_BYTES,
  cleanFilename,
  decodeMultipartFilename,
  isServerStorageKey,
  newStorageKey,
  sniffMimeType,
  storagePath,
  uploadDir,
} from './document-file'

/** Lo que entrega multer con almacenamiento en memoria; solo los campos que se usan. */
export interface UploadedDocumentFile {
  originalname: string
  size: number
  buffer: Buffer
}

interface Caller {
  sub: number
  role: Role
}

@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * DOC-1: guarda el archivo en disco y registra el documento. El tipo se decide por el contenido del archivo y la
   * clave la genera el servidor. Si falla el registro en la base, se borra el archivo para no dejar huérfanos.
   */
  async upload(placementId: number, kind: DocumentKind, file: UploadedDocumentFile | undefined, caller: Caller) {
    if (!file) throw new BadRequestException('falta el archivo')
    if (file.size > MAX_DOCUMENT_BYTES) throw new PayloadTooLargeException('el archivo supera los 10 MB')
    if (file.size === 0) throw new BadRequestException('el archivo está vacío')

    const placement = await this.prisma.placement.findFirst({ where: { id: placementId, deletedAt: null } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (caller.role !== Role.COORDINATOR && placement.studentId !== caller.sub) {
      throw new ForbiddenException('el placement no es tuyo')
    }

    const mimeType = sniffMimeType(file.buffer)
    if (!mimeType) throw new BadRequestException('solo se aceptan PDF, PNG o JPG')

    const storageKey = newStorageKey(mimeType)
    await mkdir(uploadDir(), { recursive: true })
    const path = storagePath(storageKey)
    // `wx`: nunca sobrescribe; con un UUID nuevo no debería existir, y si existe es mejor fallar.
    await writeFile(path, file.buffer, { flag: 'wx' })

    try {
      return await this.prisma.document.create({
        data: {
          placementId,
          kind,
          filename: cleanFilename(decodeMultipartFilename(file.originalname), mimeType),
          mimeType,
          size: file.size,
          storageKey,
          uploadedById: caller.sub,
          status: DocumentStatus.PENDING,
        },
      })
    } catch (error) {
      await rm(path, { force: true })
      throw error
    }
  }

  /**
   * Archivo de un documento para verlo o descargarlo: el estudiante dueño de la plaza, su tutor o la coordinación.
   * Los documentos registrados antes de DOC-1 no tienen archivo: responden 404 con un mensaje que lo dice.
   */
  async openFile(documentId: number, caller: Caller) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      include: { placement: { select: { studentId: true, tutorId: true } } },
    })
    if (!document) throw new NotFoundException('documento no encontrado')

    const { studentId, tutorId } = document.placement
    const allowed =
      caller.role === Role.COORDINATOR ||
      (caller.role === Role.STUDENT && studentId === caller.sub) ||
      (caller.role === Role.TUTOR && tutorId === caller.sub)
    if (!allowed) throw new ForbiddenException('no puedes ver este documento')

    const missing = new NotFoundException('este documento se registró sin archivo; hay que volver a subirlo')
    if (!isServerStorageKey(document.storageKey)) throw missing
    const path = storagePath(document.storageKey)
    try {
      await access(path)
    } catch {
      throw missing
    }

    return {
      stream: createReadStream(path),
      mimeType: document.mimeType,
      filename: document.filename,
      size: document.size,
    }
  }
}
