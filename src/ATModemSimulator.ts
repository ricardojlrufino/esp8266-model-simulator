import { EventEmitter } from 'events';
import * as net from 'net';
import { ModemState } from './types';
import { buffer } from 'stream/consumers';

const MAX_CONNECTIONS = 4;

export class ATModemSimulator extends EventEmitter {
  private state: ModemState;
  private commandBuffer: string = '';
  private tcpServer: net.Server | null = null;

  constructor() {
    super();
    this.state = {
      wifiConnected: false,
      cwMode: 1, //  Station mode (client)
      cipMode: 0,
      cipMux: 0,
      cipServer: 0,
      port: 0,
      ssid: '',
      password: '',
      ip: '127.0.0.1',
      mac: '11:22:33:44:55:66',
      connections: [],
      serverSocket: null
    };
  }

  public async processCommand(data: string): Promise<string | null> {
    this.commandBuffer += data;
    let responses: string[] = [];

    // Processa comandos terminados com \r\n
    const lines = this.commandBuffer.split('\r\n');
    this.commandBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        const response = await this.executeCommand(line.trim());
        if (response) {
          responses.push(response);
        }
      }
    }

    return responses.join('');
  }

  private async executeCommand(cmd: string): Promise<string> {
    
    console.log(`Executing command: ${cmd}`);
    
    let response = '\r\n\r\nERROR\r\n';

    // Comando básico AT
    if (cmd === 'AT') {
      response = '\r\n\r\nOK\r\n';
    }

    // Reset do modem
    else if (cmd === 'AT+RST') {
      response = '\r\n\r\nOK\r\n';
      this.resetModem();
      
      // Simula sequência de boot do ESP8266
      setTimeout(() => {
        this.emit('data', 'WIFI DISCONNECT\r\n\r\n' +
          ' ets Jan  8 2013,rst cause:1, boot mode:(3,7)\r\n\r\n' +
          'load 0x40100000, len 1396, room 16\r\n' +
          'tail 4\r\n' +
          'chksum 0x89\r\n' +
          'load 0x3ffe8000, len 776, room 4\r\n' +
          'tail 4\r\n' +
          'chksum 0xe8\r\n' +
          'load 0x3ffe8308, len 540, room 4\r\n' +
          'tail 8\r\n' +
          'chksum 0xc0\r\n' +
          'csum 0xc0\r\n\r\n' +
          '2nd boot version : 1.4(b1)\r\n' +
          '  SPI Speed      : 40MHz\r\n' +
          '  SPI Mode       : QIO\r\n' +
          '  SPI Flash Size & Map: 8Mbit(512KB+512KB)\r\n' +
          'jump to run user1 @ 1000\r\n\r\n' +
          'ready\r\n'
        );
      }, 500);

    }

    // Versão do firmware
    else if (cmd === 'AT+GMR') {
      response = '\r\nAT version:0.51.0.0(Nov 27 2015 13:37:21)\r\n' +
                 'SDK version:1.5.0\r\n' +
                 'compile time:Nov 27 2015 13:58:02\r\n' +
                 '\r\nOK\r\n';
    }

    // Configurar modo WiFi
    else if (cmd.startsWith('AT+CWMODE=')) {
      const mode = parseInt(cmd.split('=')[1]);
      if (mode >= 0 && mode <= 3) {
        this.state.cwMode = mode;
        response = '\r\n\r\nOK\r\n';
      }
    }

    // Query modo WiFi
    else if (cmd === 'AT+CWMODE?') {
      response = `\r\n+CWMODE:${this.state.cwMode}\r\n\r\nOK\r\n`;
    }

    // Configurar DHCP
    else if (cmd.startsWith('AT+CWDHCP=')) {
      response = '\r\n\r\nOK\r\n';
    }

    // Listar pontos de acesso
    else if (cmd === 'AT+CWLAP') {
      if (this.state.cwMode !== 2) {
        response = '\r\n' +
          '+CWLAP:(4,"rede1",-91,"30:b5:c2:2b:58:de",1)\r\n' +
          '+CWLAP:(0,"netmail12",-88,"00:0c:42:18:c6:4c",2)\r\n' +
          '+CWLAP:(0,"netmail10",-91,"00:0c:42:1f:1d:81",7)\r\n' +
          '+CWLAP:(0,"netmail11",-84,"00:0c:42:1f:73:2e",9)\r\n' +
          '\r\nOK\r\n';
      }else{
        console.error("Invalid CWMODE");
      }
    }

    else if (cmd === 'AT+CIPSTA?') {
      if (this.state.cwMode !== 2) {
        response = '\r\n' +
          '+CIPSTA:ip:192.168.0.2\r\n' +
          '+CIPSTA:gateway:192.168.0.1\r\n' +
          '+CIPSTA:netmask:255.255.255.0\r\n' +
          '\r\nOK\r\n';
      } else {
        console.error("Invalid CWMODE");
      }
    }

    // Conectar ao AP
    else if (cmd.startsWith('AT+CWJAP=')) {
      if (this.state.cwMode !== 2) {
        const match = cmd.match(/AT\+CWJAP=[""]([^""]+)[""],[""]([^""]+)[""]/) || cmd.match(/AT\+CWJAP="([^"]+)","([^"]+)"/);
        if (match) {
          this.state.ssid = match[1];
          this.state.password = match[2];
          this.state.wifiConnected = true;
          response = '\r\n\r\nWIFI CONNECTED\r\n' +
                    'WIFI GOT IP\r\n' +
                    '\r\nOK\r\n';
        } else {
          console.log(`No match for CWJAP command`);
        }
      } else {
        console.error("Invalid CWMODE");
      }
    }

    // Obter IP
    else if (cmd === 'AT+CIFSR') {
      if (this.state.wifiConnected) {
        response = `\r\n+CIFSR:STAIP,"${this.state.ip}"\r\n` +
                   `+CIFSR:STAMAC,"${this.state.mac}"\r\n` +
                   '\r\nOK\r\n';
      }
    }

    // Configurar múltiplas conexões
    //  Multiple TCP Connections (AT+CIPMUX=1):
    else if (cmd.startsWith('AT+CIPMUX=')) {
      if (this.state.cipServer === 0 && this.state.cipMode === 0) {
        this.state.cipMux = parseInt(cmd.split('=')[1]);
        response = '\r\n\r\nOK\r\n';
      }
    }

    // Query múltiplas conexões
    else if (cmd === 'AT+CIPMUX?') {
      response = `\r\n+CIPMUX:${this.state.cipMux}\r\n\r\nOK\r\n`;
    }

    // Configurar servidor TCP
    else if (cmd.startsWith('AT+CIPSERVER=')) {
      const params = cmd.split('=')[1].split(',');
      const newCipServer = parseInt(params[0]);
      const newPort = parseInt(params[1]);

      if (newCipServer === 1) {
        this.state.port = newPort;
        try {
          const serverResult = await this.startTcpServer();
          if (serverResult) {
            this.state.cipServer = newCipServer;
            response = 'OK\r\n';
          } else {
            this.state.cipServer = 0;
            response = 'ERROR\r\n';
          }
        } catch (error) {
          console.error('Error starting TCP server:', error);
          this.state.cipServer = 0;
          response = 'ERROR\r\n';
        }
      } else {
        this.stopTcpServer();
        this.state.cipServer = 0;
        response = 'OK\r\n';
      }
    }

    // Status da conexão
    // +CIPSTATUS:<link ID>,<type>,<remote IP>,<remote port>,<local port>,<tetype>
    // https://docs.espressif.com/projects/esp-at/en/release-v2.1.0.0_esp32s2/AT_Command_Set/TCP-IP_AT_Commands.html#cmd-STATUS
    else if (cmd === 'AT+CIPSTATUS') {

      if(this.state.connections.length > 0){
        response = "STATUS:3\r\n"
      }else{
        response = "STATUS:2\r\n"
      }

      response += '+CIPSTATUS:0,"TCP","192.168.0.31",38922,2000,1\r\n'+
        'OK\r\n';
    }

    // Configure AT Commands Echoing
    else if (cmd === 'ATE0' || cmd === 'ATE1') {
      response = 'OK\r\n';
    }


      // Set Socket Receiving Mode
      // 1: passive mode. ESP-AT will keep the received socket data in an internal buffer
    else if (cmd.startsWith('AT+CIPRECVMODE=1')) {
      response = 'OK\r\n';
    }
    
      // Obtain Socket Data Length in Passive Receiving Mode
    else if (cmd.startsWith('AT+CIPRECVLEN?')) {

      const len = this.state.pendingReceive?.size || 0;

      response = '+CIPRECVLEN:' + len + ',0,0,0,0 \r\nOK\r\n'; // FIXME: add size for all clients
      
    }
    
    // Obtain Socket Data in Passive Receiving Mode
    else if (cmd.startsWith('AT+CIPRECVDATA=')) {

      const params = cmd.split('=')[1].split(',');
      const linkId = parseInt(params[0]);
      const requestedLen = parseInt(params[1]);

      if (this.state.pendingReceive) {
        const availableData = this.state.pendingReceive.buffer;
        const actualLen = Math.min(requestedLen, availableData.length);
        const dataToSend = availableData.substring(0, actualLen);
        const remainingData = availableData.substring(actualLen);

        response = '\r\n'+
            '+CIPRECVDATA,' + actualLen + ':' + dataToSend+  '\r\n'+
            'OK\r\n'

        // setTimeout(()=>{
        //   this.emit("data", dataToSend + "\r\n");
        // },10);

        console.error("Send [%d] %s", actualLen, dataToSend);

        if (remainingData.length > 0) {
          this.state.pendingReceive.buffer = remainingData;
          this.state.pendingReceive.size = remainingData.length;
        } else {
          this.state.pendingReceive = undefined;
        }
      } else {
        console.error("Send DONE... +CIPRECVDATA:0... ");
        response = '+CIPRECVDATA:0,192.168.0.2,8080,\r\nOK\r\n';

      }
    }

    // Set the Maximum Connections Allowed by a Server
    else if (cmd.startsWith('AT+CIPSERVERMAXCONN=')) {
      response = 'OK\r\n';
    }

    // Set server timeout
    else if (cmd.startsWith('AT+CIPSTO=')) {
      response = 'OK\r\n';
    }


    // Enviar dados
    else if (cmd.startsWith('AT+CIPSEND=')) {
      const params = cmd.split('=')[1].split(',');
      let linkId = 0;
      let size = 0;

      if (this.state.cipMux === 1) {
        linkId = parseInt(params[0]);
        size = parseInt(params[1]);
      } else {
        size = parseInt(params[0]);
      }

      if (size > 2048){
        console.error("###### WARING - DATA TRUNCATED AT: 2048 bytes.");
        console.error("###### WARING - DATA TRUNCATED AT: 2048 bytes.");
        console.error("###### WARING - DATA TRUNCATED AT: 2048 bytes.");
        size = 2048;
      } 

      if (this.state.connections[linkId]) {

        if (this.state.pendingSend){
          this.state.pendingSend.pkgSize = size;
          this.state.pendingSend.received = 0;
        } else{
          this.state.pendingSend = {
            linkId: linkId,
            pkgSize: size,
            received: 0,
            buffer: ''
          };
        }

        this.emit('waitingForData', linkId, size); // trigger handlePendingSend after serial buffer full
        this.emit('data','OK\r\n>\r\n');
        response = '';

      } else {
        console.error("ERROR: No connection at linkId:" + linkId);
      }
    }

    // Fechar conexão
    else if (cmd.startsWith('AT+CIPCLOSE=')) {
      console.error("Received comand CLOSE, write buffer if exist")
      const linkId = parseInt(cmd.split('=')[1]);
      if (this.state.connections[linkId]) {

        if (this.state.pendingSend){
          const pending = this.state.pendingSend;
          this.state.pendingSend = undefined;
          this.state.connections[linkId].write(pending.buffer, (err => {
            if (!err) {
              console.error("Send to TCP Client (on flush):\n", pending.buffer.trim());
              this.state.connections[linkId].destroy();
              this.state.connections.splice(linkId, 1);
            }
          }));

        }else{
            this.state.connections[linkId].destroy();
            this.state.connections.splice(linkId, 1);
        }

        response = `\r\n${linkId},CLOSED\r\n\r\nOK\r\n`;
      
      
      }
    }


    if (response) console.error("Command Response:\r\n", response);

    return response;
  }

  private resetModem(): void {
    this.state.wifiConnected = false;
    this.state.cipServer = 0;
    this.state.port = 0;
    this.state.cipMux = 0; // (1) Multiple TCP Connections
    this.state.cipMode = 0; //  Transmission Mode
    this.state.ssid = '';
    this.state.password = '';
    this.state.pendingSend = undefined;
    
    this.stopTcpServer();
    this.closeAllConnections();
  }


  private async startTcpServer(): Promise<boolean> {
    if (this.tcpServer) {
      this.tcpServer.close();
    }

    // Verifica se a porta está disponível
    const isAvailable = await this.isPortAvailable(this.state.port);
    if (!isAvailable) {
      console.error(`Port ${this.state.port} is already in use`);
      return false;
    }

    try {
      this.tcpServer = net.createServer((socket) => {

        // Encontra um slot livre para a conexão
        let linkId = -1;
        for (let i = 0; i < MAX_CONNECTIONS; i++) {
          if (!this.state.connections[i]) {
            linkId = i;
            break;
          }
        }

        if (linkId !== -1) {
          
          this.state.connections[linkId] = socket;

          this.emit('data', `${linkId},CONNECT\r\n\r\n`);

          socket.on('data', async (data) => {

            const sendLater = true;

            if(sendLater){

              console.error("TCPSocket Received (%d):\r\n%s", data.length, data.toString());
              this.emit('data', `+IPD,${linkId},${data.length}\r\n`);

              if (!this.state.pendingReceive) {
                this.state.pendingReceive = {
                  linkId: linkId,
                  size: data.length,
                  buffer: data.toString()
                };
              }else{
                console.warn("WARNIGN.... pendingReceive and has new request. This may be a bug");
              }

            }else{
              const response = `+IPD,${linkId},${data.length}:${data.toString()}\r\n`;
              this.emit('data', response);
              console.error("Socket Received (%d): %s", data.length, data.toString());
              console.error("Send Response: %s {....}", response);
            }



          });

          socket.on('close', () => {
            this.state.connections.splice(linkId, 1);
            console.log('Conexão encerrada....');
            //this.emit('data', `${linkId},CLOSED\r\n`);
          });

          socket.on('error', () => {
            this.state.connections.splice(linkId, 1);
          });
        } else {
          socket.destroy();
        }
      });

      // Configura handler de erro
      this.tcpServer.on('error', (err: any) => {
        console.error('TCP server error:', err);
        this.state.cipServer = 0;
        this.tcpServer = null;
      });

      this.tcpServer.listen(this.state.port, () => {
        console.log(`TCP server listening on port ${this.state.port}`);
      });

      return true;
    } catch (error) {
      console.error('Failed to create TCP server:', error);
      return false;
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.on('error', () => {
        resolve(false);
      });
    });
  }

  private stopTcpServer(): void {
    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = null;
    }
    this.closeAllConnections();
  }

  private closeAllConnections(): void {
    for (let i = 0; i < MAX_CONNECTIONS; i++) {
      if (this.state.connections[i]) {
        this.state.connections[i].destroy(); // fire close event
      }
    }
  }

  public handlePendingSend(linkId: number, data: string): string | null {
    if (!this.state.pendingSend) {
      return null;
    }

    const pending = this.state.pendingSend;
    
    console.error("CIPSEND - Received data [length:%d, expected:%d]:\r\n%s", 
      data.length, pending.pkgSize, data);

    // Store the complete data (SerialPortInterface already handles size limits)
    pending.buffer = data;
    pending.received = data.length;

    // Send data to TCP connection
    if (this.state.connections[linkId]) {
      this.state.connections[linkId].write(data, (err) => {
        if (!err) {
          console.error("Send to TCP Client:\n", data.trim());
        }
      });
    }

    // Clear pending send state
    this.state.pendingSend = undefined;

    return `Recv ${data.length} bytes\r\n\r\nSEND OK\r\n\r\n`;
  }

  public sendData(linkId: number, data: string): void {
    if (this.state.connections[linkId]) {
      this.state.connections[linkId].write(data);
      this.emit('data', `\r\nRecv ${data.length} bytes\r\n`);
      this.emit('data', 'SEND OK\r\n');
    }
  }

  public getState(): ModemState {
    return { ...this.state };
  }
}