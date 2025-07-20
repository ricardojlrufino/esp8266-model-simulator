import { EventEmitter } from 'events';
import { ModemState } from './types';
import { MAX_CONNECTIONS, TCPManager } from './TCPManager';
import { Utils } from './Utils';


export class ATModemSimulator extends EventEmitter {
  private state: ModemState;
  private commandBuffer: string = '';
  private tcpManager: TCPManager;

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
      cipsto: 180
    };
    
    this.tcpManager = new TCPManager();
    this.setupTCPManagerEvents();
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

    // Debug Comands....
    if (cmd === 'DEBUG:') {
      response = '';
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
          const serverResult = await this.tcpManager.startServer(this.state.port);
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
        this.tcpManager.stopServer();
        this.state.cipServer = 0;
        response = 'OK\r\n';
      }
    }

    // Status da conexão
    // +CIPSTATUS:<link ID>,<type>,<remote IP>,<remote port>,<local port>,<tetype>
    // https://docs.espressif.com/projects/esp-at/en/release-v2.1.0.0_esp32s2/AT_Command_Set/TCP-IP_AT_Commands.html#cmd-STATUS
    else if (cmd === 'AT+CIPSTATUS') {
      const allConnections = this.tcpManager.getAllConnections();
      
      if (allConnections.length > 0) {
        response = "\r\nSTATUS:3\r\n";
        
        for (const conn of allConnections) {
          const teType = conn.role === 'server' ? 1 : 0;
          // Use a random high port number like real ESP8266
          const localPort = conn.localPort || (20000 + Math.floor(Math.random() * 45000));
          response += `+CIPSTATUS:${conn.linkId},"${conn.type}","${conn.remoteIP}",${conn.remotePort},${localPort},${teType}\r\n`;
        }
      } else {
        response = "\r\nSTATUS:2\r\n";
      }
      
      response += '\r\nOK\r\n';
    }

    // Configure AT Commands Echoing
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
      // Show length for all connections
      let lengths = [];
      for (let i = 0; i < MAX_CONNECTIONS; i++) {
        const len = this.tcpManager.getPendingReceiveLength(i);
        lengths.push(len.toString());
      }
      response = `\r\n+CIPRECVLEN:${lengths.join(',')}\r\n\r\nOK\r\n`;
    }
    
    // Obtain Socket Data in Passive Receiving Mode
      // response: +CIPRECVDATA:<actual_len>,<data>
    else if (cmd.startsWith('AT+CIPRECVDATA=')) {
      const params = cmd.split('=')[1].split(',');
      const linkId = parseInt(params[0]);
      const requestedLen = parseInt(params[1]);

      console.error(`DEBUG: CIPRECVDATA request for linkId=${linkId}, requestedLen=${requestedLen}`);
      console.error(`DEBUG: Connection exists: ${this.tcpManager.hasConnection(linkId)}, Pending length: ${ this.tcpManager.getPendingReceiveLength(linkId) } `);
      
      const result = this.tcpManager.getPendingReceiveData(linkId, requestedLen);
      if (result) {
        response = `\r\n\r\n+CIPRECVDATA,${result.actualLen}:${result.data}\r\n` +
                   '\r\nOK\r\n';
        console.error("DEBUG: Send [size: %d]:\r\n%s", result.actualLen, Utils.hexDump(result.data));
      } else {
        console.error("Send DONE... Response: +CIPRECVDATA:0... ");
        response = '\r\n+CIPRECVDATA:0:\r\n\r\nOK\r\n';
      }
    }

    // Set the Maximum Connections Allowed by a Server
    else if (cmd.startsWith('AT+CIPSERVERMAXCONN=')) {
      response = 'OK\r\n';
    }

    // Set server timeout
    else if (cmd.startsWith('AT+CIPSTO=')) {
      const timeoutValue = parseInt(cmd.split('=')[1]);
      if (timeoutValue >= 0 && timeoutValue <= 7200) {
        this.state.cipsto = timeoutValue;
        this.tcpManager.setServerTimeout(timeoutValue);
        response = '\r\n\r\nOK\r\n';
      } else {
        response = '\r\n\r\nERROR\r\n';
      }
    }

    // Query server timeout
    else if (cmd === 'AT+CIPSTO?') {
      response = `\r\n+CIPSTO:${this.state.cipsto}\r\n\r\nOK\r\n`;
    }

    // Establish TCP/UDP connection
    else if (cmd.startsWith('AT+CIPSTART=')) {
      const paramsStr = cmd.split('=')[1];
      const params = this.tcpManager.parseQuotedParams(paramsStr);
      
      if (params.length < 3) {
        response = '\r\n\r\nERROR\r\n';
        console.error('Invalid parameters length !');
      } else {
        let linkId = 0;
        let type: string;
        let remoteIP: string;
        let remotePort: number;
        let tcpKeepAlive: number | undefined;
        let localIP: string | undefined;

        if (this.state.cipMux === 1) {
          // Multiple connection mode
          linkId = parseInt(params[0]);
          type = params[1];
          remoteIP = params[2];
          remotePort = parseInt(params[3]);
          tcpKeepAlive = params[4] ? parseInt(params[4]) : undefined;
          localIP = params[5];
        } else {
          // Single connection mode
          type = params[0];
          remoteIP = params[1];
          remotePort = parseInt(params[2]);
          tcpKeepAlive = params[3] ? parseInt(params[3]) : undefined;
          localIP = params[4];
        }

        // Validate parameters
        if (linkId < 0 || linkId >= MAX_CONNECTIONS || 
            !['TCP', 'UDP', 'SSL'].includes(type.toUpperCase()) ||
            !remoteIP || isNaN(remotePort) || remotePort < 1 || remotePort > 65535) {
          response = '\r\n\r\nERROR\r\n';
          console.error("Invalid parameters");
        } else {
          // Check if connection already exists
          if (this.tcpManager.hasConnection(linkId)) {
            response = '\r\n\r\nALREADY CONNECTED\r\n';
          } else {
            try {
              const connected = await this.tcpManager.establishClientConnection(linkId, type.toUpperCase(), remoteIP, remotePort, tcpKeepAlive, localIP);
              if (connected) {
                response = `\r\n${linkId},CONNECT\r\n\r\nOK\r\n`;
              } else {
                response = '\r\n\r\nERROR\r\n';
              }
            } catch (error) {
              console.error('Error establishing connection:', error);
              response = '\r\n\r\nERROR\r\n';
            }
          }
        }
      }
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
        console.error("###### WARNING - DATA TRUNCATED AT: 2048 bytes.");
        size = 2048;
      } 

      if (this.tcpManager.hasConnection(linkId)) {
        this.tcpManager.setPendingSend(linkId, size);
        this.emit('startRawDataMode', linkId, size);
        response = '\r\nOK\r\n> ';
      } else {
        console.error("ERROR: No connection at linkId:" + linkId);
        response = '\r\n\r\nERROR\r\n';
      }
    }

    // Fechar conexão
    else if (cmd.startsWith('AT+CIPCLOSE=')) {
      console.error("Received command CLOSE");
      const linkId = parseInt(cmd.split('=')[1]);
      
      if (this.tcpManager.hasConnection(linkId)) {
        this.tcpManager.closeConnection(linkId);
        response = `\r\n${linkId},CLOSED\r\n\r\nOK\r\n`;
      } else {
        response = '\r\n\r\nERROR\r\n';
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
    this.state.cipsto = 180;
    
    this.tcpManager.stopServer();
    this.tcpManager.closeAllConnections();
  }

  public handlePendingSend(linkId: number, data: Buffer): string | null {
    return this.tcpManager.handlePendingSend(linkId, data);
  }

  public handlePendingSendBuffer(linkId: number, data: Buffer): string | null {
    return this.tcpManager.handlePendingSendBuffer(linkId, data);
  }

  public sendData(linkId: number, data: string): void {
    const sent = this.tcpManager.sendData(linkId, data);
    if (sent) {
      this.emit('data', `\r\nRecv ${data.length} bytes\r\n`);
      this.emit('data', 'SEND OK\r\n');
    }
  }

  public getState(): ModemState {
    return { ...this.state };
  }

  private setupTCPManagerEvents(): void {
    this.tcpManager.on('serverConnectionEstablished', (linkId: number) => {
      this.emit('data', `${linkId},CONNECT\r\n\r\n`);
    });

    this.tcpManager.on('dataReceived', (linkId: number, dataLength: number) => {
      console.error(`+IPD,${linkId},${dataLength} - Socket Received data`);
      this.emit('data', `+IPD,${linkId},${dataLength}\r\n`);
    });

    this.tcpManager.on('connectionClosed', (linkId: number) => {
      this.emit('data', `${linkId},CLOSED\r\n`);
    });

    this.tcpManager.on('connectionError', (linkId: number, error: Error) => {
      this.emit('data', `${linkId},CLOSED\r\n`);
    });

  }
}