import * as numeral from 'numeral';
import * as kdj from 'kdj';
import { DateTime } from 'luxon';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RestClient } from '@fugle/marketdata';
import { InjectRestClient } from '@fugle/marketdata-nest';
import { InjectLineNotify, LineNotify } from 'nest-line-notify';
import { CandlesData, NotificationPayload } from './interfaces';

@Injectable()
export class NotifierService {
  private readonly symbol = '0050';
  private candles: CandlesData;

  constructor(
    @InjectRestClient() private readonly client: RestClient,
    @InjectLineNotify() private readonly lineNotify: LineNotify,
  ) { }

  async onApplicationBootstrap() {
    await this.initCandles();
  }

  @Cron('0 0 8 * * *')
  async initCandles() {
    const symbol = this.symbol;
    const to = DateTime.local().toISODate();
    const from = DateTime.local().minus({ month: 3 }).toISODate();
    const candles = await this.client.stock.historical.candles({
      symbol, from, to,
    });

    this.candles = candles.data.reverse().reduce((candles, candle) => ({
      ...candles,
      date: [...candles.date, candle.date],
      open: [...candles.open, candle.open],
      high: [...candles.high, candle.high],
      low: [...candles.low, candle.low],
      close: [...candles.close, candle.close],
      volume: [...candles.volume, candle.volume],
    }), { date: [], open: [], high: [], low: [], close: [], volume: [] });

    Logger.log('candles data initialized', NotifierService.name)
  }

  @Cron('00 25 13 * * *')
  async fetchQuote() {
    const symbol = this.symbol;
    const quote = await this.client.stock.intraday.quote({ symbol });
    if (quote.date !== DateTime.local().toISODate()) return;

    const index = this.candles.date.indexOf(quote.date);
    if (index === -1) {
      this.candles.date.push(quote.date);
      this.candles.open.push(quote.openPrice);
      this.candles.high.push(quote.highPrice);
      this.candles.low.push(quote.lowPrice);
      this.candles.close.push(quote.closePrice);
      this.candles.volume.push(quote.total?.tradeVolume * 1000);
    } else {
      this.candles.date[index] = quote.date;
      this.candles.open[index] = quote.openPrice;
      this.candles.high[index] = quote.highPrice;
      this.candles.low[index] = quote.lowPrice;
      this.candles.close[index] = quote.closePrice;
      this.candles.volume[index] = quote.total.tradeVolume * 1000;
    }

    const { close, low, high } = this.candles;
    const indicator = kdj(close, low, high);
    const k = indicator.K.slice(-1)[0];
    const d = indicator.D.slice(-1)[0];
    const j = indicator.J.slice(-1)[0];

    await this.sendNotification({
      symbol: quote.symbol,
      name: quote.name,
      price: numeral(quote.closePrice).format('0.00'),
      volume: numeral(quote.total.tradeVolume).format('0'),
      change: numeral(quote.change).format('+0.00'),
      changePercent: numeral(quote.changePercent).format('+0.00'),
      time: DateTime.fromMillis(Math.floor(quote.lastUpdated / 1000)).toFormat('yyyy/MM/dd HH:mm:ss'),
      k: numeral(k).format('0.00'),
      d: numeral(d).format('0.00'),
      j: numeral(j).format('0.00'),
    });
  }

  async sendNotification(payload: NotificationPayload) {
    const { symbol, name, price, change, changePercent, time, k, d, j } = payload;

    const message = [''].concat([
      `${name} (${symbol})`,
      `---`,
      `成交: ${price}`,
      `漲跌: ${change} (${changePercent})`,
      `K: ${k} D: ${d} J: ${j}`,
      `---`,
      `時間: ${time}`,
    ]).join('\n');

    await this.lineNotify.send({ message })
      .then(() => Logger.log(message, NotifierService.name))
      .catch(err => Logger.error(err.message, err.stack, NotifierService.name));
  }
}
