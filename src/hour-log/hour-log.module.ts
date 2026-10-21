import { Module } from '@nestjs/common'
import { HourLogController } from './hour-log.controller'
import { HourLogService } from './hour-log.service'
import { HourLogNotificationService } from './hour-log-notification.service'
import { HourLogReportService } from './hour-log-report.service'
import { HourLogExportService } from './hour-log-export.service'

@Module({
  controllers: [HourLogController],
  providers: [HourLogService, HourLogNotificationService, HourLogReportService, HourLogExportService],
  exports: [HourLogService],
})
export class HourLogModule {}
