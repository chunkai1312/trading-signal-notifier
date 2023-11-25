import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { FugleMarketDataModule } from '@fugle/marketdata-nest';
import { LineNotifyModule } from 'nest-line-notify';
import { NotifierModule } from './notifier/notifier.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    FugleMarketDataModule.forRoot({
      apiKey: process.env.FUGLE_MARKETDATA_API_KEY,
    }),
    LineNotifyModule.forRoot({
      accessToken: process.env.LINE_NOTIFY_ACCESS_TOKEN,
    }),
    NotifierModule,
  ],
})
export class AppModule {}
