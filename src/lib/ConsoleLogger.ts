import * as util from 'util';

import { Logger } from './Logger';

export enum LogLevel {
  debug,
  info,
  warn,
  error,
  disabled,
}

export class ConsoleLogger implements Logger {

  private level: LogLevel;

  constructor(logLevel?: string) {
    const envLevel: string = process.env.LOG_LEVEL;
    this.level = LogLevel[logLevel || envLevel || 'debug'];
  }

  protected argsToMessage(args: any[]): string {
    const strArgs = args.map(arg => (
      typeof arg === 'string' ? arg : util.inspect(arg, { depth: null })
    ));
    return strArgs.join(' ');
  }

  protected log(level: LogLevel, args: any): void {
    if (level >= this.level) {
      const levelStr = LogLevel[level].toUpperCase();
      const message = this.argsToMessage(args);
      console.log(`${levelStr} ${message}`); // tslint:disable-line
    }
  }

  debug(...args: any[]): void {
    this.log(LogLevel.debug, args);
  }

  info(...args: any[]): void {
    this.log(LogLevel.info, args);
  }

  warn(...args: any[]): void {
    this.log(LogLevel.warn, args);
  }

  error(...args: any[]): void {
    this.log(LogLevel.error, args);
  }
}
