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
  private readonly symbol = 'IX0001';
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

    Logger.log(`${symbol} candles data initialized`, NotifierService.name);
  }

  @Cron('00 30 12 * * *')
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
      this.candles.volume.push(quote.total?.tradeValue);
    } else {
      this.candles.date[index] = quote.date;
      this.candles.open[index] = quote.openPrice;
      this.candles.high[index] = quote.highPrice;
      this.candles.low[index] = quote.lowPrice;
      this.candles.close[index] = quote.closePrice;
      this.candles.volume[index] = quote.total.tradeValue;
    }

    const { close, low, high } = this.candles;
    const indicator = kdj(close, low, high);
    const k = indicator.K.slice(-1)[0];
    const d = indicator.D.slice(-1)[0];
    const j = indicator.J.slice(-1)[0];

    await this.sendNotification({
      symbol: quote.symbol,
      name: quote.name,
      open: numeral(quote.openPrice).format('0.00'),
      high: numeral(quote.highPrice).format('0.00'),
      low: numeral(quote.lowPrice).format('0.00'),
      close: numeral(quote.closePrice).format('0.00'),
      volume: numeral(quote.total.tradeValue).divide(1e8).format('0.00'),
      change: numeral(quote.change).format('+0.00'),
      changePercent: numeral(quote.changePercent).format('+0.00'),
      time: DateTime.fromMillis(Math.floor(quote.lastUpdated / 1000)).toFormat('yyyy/MM/dd HH:mm:ss'),
      k: numeral(k).format('0.00'),
      d: numeral(d).format('0.00'),
      j: numeral(j).format('0.00'),
    });
  }

  async sendNotification(payload: NotificationPayload) {
    const message = [''].concat([
      `${payload.name} (${payload.symbol})`,
      `---`,
      `開: ${payload.open}`,
      `高: ${payload.high}`,
      `低: ${payload.low}`,
      `收: ${payload.close}`,
      `量: ${payload.volume}億元`,
      `${+payload.change < 0 ? '跌' : '漲'}: ${payload.change}`,
      `幅: ${payload.changePercent}%`,
      `---`,
      `K: ${payload.k} D: ${payload.d} J: ${payload.j}`,
      `---`,
      `時間: ${payload.time}`,
    ]).join('\n');

    await this.lineNotify.send({ message })
      .then(() => Logger.log(message, NotifierService.name))
      .catch(err => Logger.error(err.message, err.stack, NotifierService.name));
  }
}
