import { Module } from '@nestjs/common';
import { NotifierService } from './notifier.service';

@Module({
  providers: [NotifierService],
})
export class NotifierModule {}
