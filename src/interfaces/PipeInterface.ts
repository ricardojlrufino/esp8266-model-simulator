import * as readline from 'readline';
import { ATModemSimulator } from '../ATModemSimulator';

export class PipeInterface {
  private modem: ATModemSimulator;
  private rl: readline.Interface;

  constructor(modem: ATModemSimulator) {
    this.modem = modem;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.rl.on('line', async (input) => {
      const response = await this.modem.processCommand(input + '\r\n');
      if (response) {
        process.stdout.write(response);
      }
    });

    this.modem.on('data', (data) => {
      process.stdout.write(data);
    });

    this.modem.on('waitingForData', (linkId, size) => {
      this.rl.question('', (data) => {
        if (data.length <= size) {
          this.modem.sendData(linkId, data);
        }
      });
    });

    this.modem.on('binaryResponse', (responseBuffer: Buffer) => {
      process.stdout.write(responseBuffer);
    });
  }

  public start(): void {
    console.log('AT Modem Simulator started (PIPE interface)');
    console.log('Type AT commands or Ctrl+C to exit');
    this.rl.prompt();
  }

  public stop(): void {
    this.rl.close();
  }
}