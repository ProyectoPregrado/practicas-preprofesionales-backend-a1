import { Injectable } from '@nestjs/common'

// Adaptador de la notificación actual: solo consola, no entrega email.
@Injectable()
export class HourLogNotificationService {
  notifyTutor(tutorId: number, hourLogId: number): void {
    console.log(`[notificación] tutor ${tutorId}: nueva hora registrada #${hourLogId}`)
  }
}
