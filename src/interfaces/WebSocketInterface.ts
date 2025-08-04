import { Server as SocketServer } from 'socket.io';
import { createServer } from 'http';
import { ATModemSimulator } from '../ATModemSimulator';

export class WebSocketInterface {
  private modem: ATModemSimulator;
  private server: SocketServer;
  private httpServer: any;

  constructor(modem: ATModemSimulator, port: number = 3000) {
    this.modem = modem;
    this.httpServer = createServer();
    this.server = new SocketServer(this.httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupEventHandlers();
    this.httpServer.listen(port);
  }

  private setupEventHandlers(): void {
    this.server.on('connection', (socket) => {
      console.log('WebSocket client connected');

      socket.on('command', async (data) => {
        const response = await this.modem.processCommand(data);
        if (response) {
          socket.emit('response', response);
        }
      });

      socket.on('sendData', ({ linkId, data }) => {
        this.modem.sendData(linkId, data);
      });

      socket.on('getState', () => {
        socket.emit('state', this.modem.getState());
      });

      socket.on('disconnect', () => {
        console.log('WebSocket client disconnected');
      });
    });

    this.modem.on('data', (data) => {
      this.server.emit('response', data);
    });

    this.modem.on('waitingForData', (linkId, size) => {
      this.server.emit('waitingForData', { linkId, size });
    });

    this.modem.on('binaryResponse', (responseBuffer: Buffer) => {
      // Convert Buffer to base64 for WebSocket transmission
      this.server.emit('response', responseBuffer.toString('base64'));
    });
  }

  public start(): void {
    console.log('AT Modem Simulator started (WebSocket interface on port 3000)');
  }

  public stop(): void {
    this.httpServer.close();
  }
}