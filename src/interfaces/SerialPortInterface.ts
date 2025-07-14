import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { ATModemSimulator } from '../ATModemSimulator';

export class SerialPortInterface {
  private modem: ATModemSimulator;
  private serialPort: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private portPath: string;
  private baudRate: number;

  constructor(modem: ATModemSimulator, portPath: string, baudRate: number = 115200) {
    this.modem = modem;
    this.portPath = portPath;
    this.baudRate = baudRate;
  }

  public async start(): Promise<void> {
    try {
      this.serialPort = new SerialPort({
        path: this.portPath,
        baudRate: this.baudRate,
        autoOpen: false
      });

      this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      
      await this.openPort();
      this.setupEventHandlers();
      
      console.log(`AT Modem Simulator started (Serial interface on ${this.portPath} at ${this.baudRate} baud)`);
    } catch (error) {
      console.error('Failed to start serial interface:', error);
      throw error;
    }
  }

  private openPort(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.serialPort) {
        reject(new Error('Serial port not initialized'));
        return;
      }

      this.serialPort.open((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

    });
  }

  private setupEventHandlers(): void {
    if (!this.serialPort || !this.parser) return;

    this.parser.on('data', async (data: string) => {
      const response = await this.modem.processCommand(data + '\n');
      if (response && this.serialPort) {
        this.serialPort.write(response);
      }
    });

    this.modem.on('data', (data: string) => {
      if (this.serialPort) {
        this.serialPort.write(data);
      }
    });

    this.modem.on('waitingForData', (linkId: number, size: number) => {
      if (this.serialPort) {
        this.serialPort.write(`> `);
        
        let dataBuffer = '';
        const onData = (data: Buffer) => {
          dataBuffer += data.toString();
          if (dataBuffer.length >= size || dataBuffer.includes('\r\n')) {
            this.serialPort?.removeListener('data', onData);
            const finalData = dataBuffer.replace('\r\n', '').substring(0, size);
            this.modem.sendData(linkId, finalData);
          }
        };
        this.serialPort.on('data', onData);
      }
    });

    this.serialPort.on('error', (error) => {
      console.error('Serial port error:', error);
    });

    this.serialPort.on('close', () => {
      console.log('Serial port closed');
    });
  }

  public stop(): void {
    if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.close();
    }
  }

  public static async listPorts(): Promise<any[]> {
    return await SerialPort.list();
  }
}