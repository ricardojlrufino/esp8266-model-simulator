#!/usr/bin/env node

// Copyright (c) 2025 Ricardo JL Rufino
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { ATModemSimulator } from './ATModemSimulator';
import { PipeInterface } from './interfaces/PipeInterface';
import { WebSocketInterface } from './interfaces/WebSocketInterface';
import { SerialPortInterface } from './interfaces/SerialPortInterface';

// Aplicação principal
class ATModemApp {
  private modem: ATModemSimulator;
  private pipeInterface: PipeInterface;
  private webSocketInterface: WebSocketInterface;
  private serialInterface: SerialPortInterface | null = null;

  constructor() {
    this.modem = new ATModemSimulator();
    this.pipeInterface = new PipeInterface(this.modem);
    this.webSocketInterface = new WebSocketInterface(this.modem);
  }

  public async start(): Promise<void> {
    const args = process.argv.slice(2);
    const connType = args[0] || 'pipe';

    if (connType === 'websocket' || connType === 'ws') {
      this.webSocketInterface.start();
    } else if (connType === 'serial') {
      const portPath = args[1];
      const baudRate = args[2] ? parseInt(args[2]) : 115200;

      if (!portPath) {
        console.log('Available serial ports:');
        const ports = await SerialPortInterface.listPorts();
        ports.forEach(port => {
          console.log(`  ${port.path} - ${port.manufacturer || 'Unknown'}`);
        });
        console.log('\nUsage: npm run dev serial <port_path> [baud_rate]');
        console.log('Example: npm run dev serial /dev/ttyUSB0 115200');
        process.exit(1);
      }

      this.serialInterface = new SerialPortInterface(this.modem, portPath, baudRate);
      try {
        await this.serialInterface.start();
      } catch (error) {
        console.error('Failed to start serial interface:', error);
        process.exit(1);
      }
    } else {
      this.pipeInterface.start();
    }

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      this.pipeInterface.stop();
      this.webSocketInterface.stop();
      if (this.serialInterface) {
        this.serialInterface.stop();
      }
      process.exit(0);
    });
  }
}

// Executar aplicação
if (require.main === module) {
  const app = new ATModemApp();
  app.start().catch(console.error);
}

export { ATModemSimulator, PipeInterface, WebSocketInterface, SerialPortInterface, ATModemApp };