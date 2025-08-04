import { SerialPort } from 'serialport';
import { ATModemSimulator } from '../ATModemSimulator';

export class SerialPortInterface {
  private modem: ATModemSimulator;
  private serialPort: SerialPort | null = null;
  private portPath: string;
  private baudRate: number;
  private rawDataMode: boolean = false;
  private rawDataBuffer: Buffer = Buffer.alloc(0);
  private expectedDataSize: number = 0;
  private currentLinkId: number = 0;
  private commandBuffer: Buffer = Buffer.alloc(0);

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
        autoOpen: false,
      });

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

    if (!this.serialPort) return;

    // Single handler for all serial data
    this.serialPort.on('data', (data: Buffer) => {
      // console.error("Serial data received: %d bytes, rawMode: %s", data.length, this.rawDataMode);
      if (this.rawDataMode) {
        this.handleRawData(data);
      } else {
        this.handleCommandData(data);
      }
    });

    this.modem.on('data', (data: string) => {
      if (this.serialPort) {
        this.serialPort.write(data);
      }
    });

    this.modem.on('startRawDataMode', (linkId: number, size: number) => {
      this.startRawDataMode(linkId, size);
    });

    this.modem.on('binaryResponse', (responseBuffer: Buffer) => {
      if (this.serialPort) {
        // Send the complete response as binary data (preserves exact byte values)
        this.serialPort.write(responseBuffer);
      }
    });

    this.serialPort.on('error', (error) => {
      console.error('Serial port error:', error);
    });

    this.serialPort.on('close', () => {
      console.log('Serial port closed');
    });
  }

  private async handleCommandData(data: Buffer): Promise<void> {
    this.commandBuffer = Buffer.concat([this.commandBuffer, data]);
    
    // Look for complete lines ending with \n
    const bufferStr = this.commandBuffer.toString();
    const lines = bufferStr.split('\n');
    
    // Keep the last incomplete line in the buffer
    this.commandBuffer = Buffer.from(lines.pop() || '');
    
    // Process complete lines
    for (const line of lines) {
      if (line.trim()) {
        // console.error("Processing command: %s", line.trim());
        const response = await this.modem.processCommand(line + '\n');
        if (response && this.serialPort) {
          this.serialPort.write(response);
        }
      }
    }
  }

  private startRawDataMode(linkId: number, size: number): void {
    console.error("Starting [RAW DATA MODE] for linkId %d, expecting %d bytes", linkId, size);
    this.rawDataMode = true;
    this.currentLinkId = linkId;
    this.expectedDataSize = size;
    this.rawDataBuffer = Buffer.alloc(0);
  }

  private handleRawData(data: Buffer): void {

    this.rawDataBuffer = Buffer.concat([this.rawDataBuffer, data]);
    
    console.error("Raw data received: %d bytes, total: %d/%d", 
      data.length, 
      this.rawDataBuffer.length, 
      this.expectedDataSize
    );

    if (this.rawDataBuffer.length >= this.expectedDataSize) {
      // Got all expected data - take exactly the expected size
      const finalDataBuffer = this.rawDataBuffer.subarray(0, this.expectedDataSize);
      const remainingData = this.rawDataBuffer.subarray(this.expectedDataSize);
      
      console.error("Raw data complete, processing %d bytes", this.expectedDataSize);
      
      // Process the complete data packet - pass Buffer directly
      const resp = this.modem.handlePendingSendBuffer(this.currentLinkId, finalDataBuffer);
      if (resp && this.serialPort) {
        this.serialPort.write(resp);
      }
      
      // Exit raw mode 
      console.error("Exiting raw data mode");
      this.rawDataMode = false;
      this.rawDataBuffer = Buffer.alloc(0);
      
      // Process any remaining data as commands if present
      if (remainingData.length > 0) {
        setTimeout(() => {
          this.processRemainingData(remainingData);
        }, 0);
      }
    }
  }

  private async processRemainingData(data: Buffer): Promise<void> {
    // Process remaining data as commands using the same handler
    await this.handleCommandData(data);
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