// Copyright (c) 2025 Ricardo JL Rufino
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import * as net from 'net';
import * as dgram from 'dgram';
import * as tls from 'tls';
import { EventEmitter } from 'events';
import { Utils } from './Utils';

export interface TCPConnection {
  linkId: number;
  type: 'TCP' | 'UDP' | 'SSL';
  role: 'server' | 'client';
  remoteIP: string;
  remotePort: number;
  localPort?: number;
  tcpKeepAlive?: number;
  localIP?: string;
  socket: net.Socket | dgram.Socket | tls.TLSSocket | net.Server | null;
  pendingSend?: {
    pkgSize: number;
    received: number;
    buffer: Buffer;
  };
  pendingReceive?: {
    size: number;
    buffer: Buffer;
  };
  lastActivity?: number;
  timeoutTimer?: NodeJS.Timeout;
}

export const MAX_CONNECTIONS = 5;

export class TCPManager extends EventEmitter {
  private connections: Map<number, TCPConnection> = new Map();
  private tcpServer: net.Server | null = null;
  private maxConnections: number = MAX_CONNECTIONS;
  private serverTimeout: number = 180;

  public parseQuotedParams(paramsStr: string): string[] {
    const params: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < paramsStr.length) {
      const char = paramsStr[i];
      
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        inQuotes = false;
        params.push(current);
        current = '';
        i++; // Skip the comma after closing quote
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          params.push(current.trim());
        }
        current = '';
      } else if (inQuotes || char !== ' ') {
        current += char;
      }
      i++;
    }

    if (current.trim()) {
      params.push(current.trim());
    }

    return params;
  }

  public async startServer(port: number): Promise<boolean> {
    if (this.tcpServer) {
      this.tcpServer.close();
    }

    // Check if port is available
    const isAvailable = await this.isPortAvailable(port);
    if (!isAvailable) {
      console.error(`Port ${port} is already in use`);
      return false;
    }

    try {
      this.tcpServer = net.createServer((socket) => {
        // Find free slot for connection
        let linkId = -1;
        for (let i = 0; i < this.maxConnections; i++) {
          if (!this.connections.has(i)) {
            linkId = i;
            break;
          }
        }

        if (linkId !== -1) {
          const connection: TCPConnection = {
            linkId,
            type: 'TCP',
            role: 'server',
            remoteIP: socket.remoteAddress || 'unknown',
            remotePort: socket.remotePort || 0,
            localPort: port,
            socket
          };

          this.connections.set(linkId, connection);
          this.setupConnectionTimeout(linkId, connection);
          this.emit('serverConnectionEstablished', linkId);

          socket.on('data', (data) => {
            this.resetConnectionActivity(linkId);
            this.handleSocketData(linkId, data);
          });

          socket.on('close', () => {
            this.connections.delete(linkId);
            this.emit('connectionClosed', linkId);
          });

          socket.on('error', (err) => {
            this.connections.delete(linkId);
            this.emit('connectionError', linkId, err);
          });
        } else {
          socket.destroy();
        }
      });

      this.tcpServer.on('error', (err: any) => {
        console.error('TCP server error:', err);
        this.tcpServer = null;
      });

      this.tcpServer.listen(port, () => {
        console.log(`TCP server listening on port ${port}`);
      });

      return true;
    } catch (error) {
      console.error('Failed to create TCP server:', error);
      return false;
    }
  }

  public stopServer(): void {
    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = null;
    }
    this.closeAllConnections();
  }

  public async establishClientConnection(linkId: number, type: string, remoteIP: string, remotePort: number, tcpKeepAlive: number = 60000, localIP?: string): Promise<boolean> {
    return new Promise((resolve) => {


      const handlerSocketClose = (linkId : number) => {
        const connection = this.connections.get(linkId);
        if(connection) {
          // Mark socket as closed but keep connection data if there's pending receive data
          connection.socket = null;
          if (!connection.pendingReceive || connection.pendingReceive.size === 0) {
            this.connections.delete(linkId);
            this.emit('connectionClosed', linkId);
          } else {
            console.error(`[TCPManager] Socket closed but keeping connection ${linkId} due to pending receive data (${connection.pendingReceive.size} bytes)`);
          }
        }
      }

      if (type === 'TCP') {
        const socket = new net.Socket();
        socket.setKeepAlive(true, tcpKeepAlive);
        socket.setTimeout(0);
        // socket.setNoDelay(true);
        // socket.setEncoding('utf8');
        
        const connectTimeout = setTimeout(() => {
          socket.destroy();
          resolve(false);
        }, 10000);

        socket.connect(remotePort, remoteIP, () => {
          clearTimeout(connectTimeout);
          
          const connection: TCPConnection = {
            linkId,
            type: 'TCP',
            role: 'client',
            remoteIP,
            remotePort,
            tcpKeepAlive,
            localIP,
            socket
          };
          
          this.connections.set(linkId, connection);
          
          socket.on('data', (data) => {
            this.handleSocketData(linkId, data);
          });

          socket.on('close', () => {
            handlerSocketClose(linkId);
          });
          
          socket.on('timeout', () => {
            console.error(`Connection ${linkId} timeout - keeping alive`);
          });

          socket.on('error', (err) => {
            console.error(`Connection ${linkId} error:`, err);
            // Don't immediately delete connection if there's pending receive data
            const connection = this.connections.get(linkId);
            if (connection && connection.pendingReceive && connection.pendingReceive.size > 0) {
              console.error(`[TCPManager] Socket error but keeping connection ${linkId} due to pending receive data (${connection.pendingReceive.size} bytes)`);
              connection.socket = null; // Mark socket as closed
            } else {
              this.connections.delete(linkId);
            }
            this.emit('connectionError', linkId, err);
          });

          resolve(true);
        });

        socket.on('error', (err) => {
          clearTimeout(connectTimeout);
          console.error(`Failed to connect to ${remoteIP}:${remotePort}:`, err);
          resolve(false);
        });

      } else if (type === 'UDP') {
        const socket = dgram.createSocket('udp4');
        
        try {
          const connection: TCPConnection = {
            linkId,
            type: 'UDP',
            role: 'client',
            remoteIP,
            remotePort,
            tcpKeepAlive,
            localIP,
            socket
          };
          
          this.connections.set(linkId, connection);
          
          socket.on('message', (msg, rinfo) => {
            this.handleSocketData(linkId, msg);
          });

          socket.on('error', (err) => {
            this.connections.delete(linkId);
            this.emit('connectionError', linkId, err);
          });

          // Store remote info for UDP
          (socket as any).remoteAddress = remoteIP;
          (socket as any).remotePort = remotePort;
          
          resolve(true);
        } catch (error) {
          console.error(`Failed to create UDP connection:`, error);
          resolve(false);
        }

      } else if (type === 'SSL') {
        const socket = tls.connect(remotePort, remoteIP, { rejectUnauthorized: false }, () => {

          socket.setKeepAlive(true, tcpKeepAlive);

          const connection: TCPConnection = {
            linkId,
            type: 'SSL',
            role: 'client',
            remoteIP,
            remotePort,
            tcpKeepAlive,
            localIP,
            socket
          };
          
          this.connections.set(linkId, connection);
          
          socket.on('data', (data) => {
            this.handleSocketData(linkId, data);
          });

          socket.on('close', () => {
            handlerSocketClose(linkId);
          });

          socket.on('error', (err) => {
            this.connections.delete(linkId);
            this.emit('connectionError', linkId, err);
          });

          resolve(true);
        });

        socket.on('error', (err) => {
          console.error(`Failed to establish SSL connection to ${remoteIP}:${remotePort}:`, err);
          resolve(false);
        });

      } else {
        resolve(false);
      }
    });
  }

  private handleSocketData(linkId: number, data: Buffer): void {
    const connection = this.connections.get(linkId);
    if (!connection) return;

    console.error(`[handleSocketData] ${connection.role} connection ${linkId} received (${data.length}):`);
    console.error(Utils.hexDump(data));
    
    // Check for MQTT PING packets for debugging and special handling
    if (data.length === 2) {
      if (data[0] === 0xc0 && data[1] === 0x00) {
        console.error(`[MQTT DEBUG] PINGREQ detected on connection ${linkId}`);
      } else if (data[0] === 0xd0 && data[1] === 0x00) {
        console.error(`[MQTT DEBUG] PINGRESP detected on connection ${linkId}`);
      }
    }
    
    
    if (!connection.pendingReceive) {
      connection.pendingReceive = {
        size: data.length,
        buffer: data
      };
      this.emit('dataReceived', linkId, data.length);
    } else {
      // Accumulate additional data chunks
      connection.pendingReceive.buffer = Buffer.concat([connection.pendingReceive.buffer, data]);
      connection.pendingReceive.size += data.length;
      console.error(`[handleSocketData] Connection ${linkId} accumulated data, total size: ${connection.pendingReceive.size}`);
      this.emit('dataReceived', linkId, data.length);
    }
  }

  public getConnection(linkId: number): TCPConnection | undefined {
    return this.connections.get(linkId);
  }

  public hasConnection(linkId: number): boolean {
    return this.connections.has(linkId);
  }

  public closeConnection(linkId: number): void {
    const connection = this.connections.get(linkId);
    if (connection && connection.socket) {
      if (connection.type === 'UDP') {
        (connection.socket as dgram.Socket).close();
      } else if (connection.socket instanceof net.Server) {
        (connection.socket as net.Server).close();
      } else {
        (connection.socket as net.Socket).destroy();
      }
      this.connections.delete(linkId);
    }
  }

  public sendData(linkId: number, data: string): boolean {
    const connection = this.connections.get(linkId);
    if (!connection || !connection.socket) {
      return false;
    }

    try {
      if (connection.type === 'UDP') {
        const socket = connection.socket as dgram.Socket;
        socket.send(data, connection.remotePort, connection.remoteIP);
      } else {
        const socket = connection.socket as net.Socket;
        socket.write(data);
      }
      return true;
    } catch (error) {
      console.error(`Failed to send data to connection ${linkId}:`, error);
      return false;
    }
  }

  public sendDataBuffer(linkId: number, data: Buffer): boolean {
    const connection = this.connections.get(linkId);
    if (!connection || !connection.socket) {
      return false;
    }

    try {
      if (connection.type === 'UDP') {
        const socket = connection.socket as dgram.Socket;
        socket.send(data, connection.remotePort, connection.remoteIP);
      } else {
        const socket = connection.socket as net.Socket;
        socket.write(data);
      }
      return true;
    } catch (error) {
      console.error(`Failed to send buffer data to connection ${linkId}:`, error);
      return false;
    }
  }

  public getAllConnections(): TCPConnection[] {
    return Array.from(this.connections.values());
  }

  public closeAllConnections(): void {
    for (const [linkId, connection] of this.connections) {
      this.closeConnection(linkId);
    }
  }

  public setPendingSend(linkId: number, pkgSize: number): void {
    const connection = this.connections.get(linkId);
    if (connection) {
      connection.pendingSend = {
        pkgSize,
        received: 0,
        buffer: Buffer.alloc(0)
      };
    }
  }

  public handlePendingSend(linkId: number, data: Buffer): string | null {
    const connection = this.connections.get(linkId);
    if (!connection || !connection.pendingSend) {
      return null;
    }

    const pending = connection.pendingSend;
    
    console.error(`CIPSEND - Connection ${linkId} received data [length:${data.length}, expected:${pending.pkgSize}]:`);
    console.error(Utils.hexDump(data));

    // Check for MQTT PING packets
    if (data.length === 2) {
      if (data[0] === 0xc0 && data[1] === 0x00) {
        console.error(`[MQTT DEBUG] PINGREQ being sent from client on connection ${linkId}`);
      } else if (data[0] === 0xd0 && data[1] === 0x00) {
        console.error(`[MQTT DEBUG] PINGRESP being sent from client on connection ${linkId}`);
      }
    }

    // Store the complete data as Buffer
    pending.buffer = data;
    pending.received = data.length;

    // Send data through socket
    const sent = this.sendDataBuffer(linkId, data);
    if (sent) {
      console.error(`Send to ${connection.role} connection ${linkId} - OK`);
    }

    // Clear pending send state
    connection.pendingSend = undefined;

    return `\r\nRecv ${data.length} bytes\r\n\r\nSEND OK\r\n`;
  }

  public handlePendingSendBuffer(linkId: number, data: Buffer): string | null {
    const connection = this.connections.get(linkId);
    if (!connection || !connection.pendingSend) {
      return null;
    }

    const pending = connection.pendingSend;
    
    console.error(`CIPSEND - Connection ${linkId} received data [length:${data.length}, expected:${pending.pkgSize}]:`);
    console.error(Utils.hexDump(data));

    // Check for MQTT PING packets for debugging and special handling
    if (data.length === 2) {
      if (data[0] === 0xc0 && data[1] === 0x00) {
        console.error(`[MQTT DEBUG] Send PINGREQ to connection ${linkId}`);
      } else if (data[0] === 0xd0 && data[1] === 0x00) {
        console.error(`[MQTT DEBUG] Send PINGRESP to connection ${linkId}`);
      }
    }

    // Store the complete data as Buffer
    pending.buffer = data;
    pending.received = data.length;

    // Send data through socket as Buffer
    const sent = this.sendDataBuffer(linkId, data);
    if (sent) {
      console.error(`Send to ${connection.role} connection ${linkId} - OK`);
    }

    // Clear pending send state
    connection.pendingSend = undefined;

    return `\r\nRecv ${data.length} bytes\r\n\r\nSEND OK\r\n`;
  }


  private toReadableString(data: string): string {
    return Array.from(data)
      .map((char: string) => {
        const code: number = char.charCodeAt(0);
        // Caracteres imprimíveis ASCII (32-126)
        if (code >= 32 && code <= 126) {
          return char;
        }
        // Caracteres de controle comuns
        switch (code) {
          case 9: return '\\t';
          case 10: return '\\n';
          case 13: return '\\r';
          default: return `\\x${code.toString(16).padStart(2, '0')}`;
        }
      })
      .join('');
  };

  

  public getPendingReceiveData(linkId: number, requestedLen: number): { data: Buffer; actualLen: number } | null {
    const connection = this.connections.get(linkId);
    if (!connection || !connection.pendingReceive) {
      return null;
    }

    const availableData = connection.pendingReceive.buffer;
    const actualLen = Math.min(requestedLen, availableData.length);
    const dataToSend = availableData.subarray(0, actualLen);
    const remainingData = availableData.subarray(actualLen);

    if (remainingData.length > 0) {
      connection.pendingReceive.buffer = remainingData;
      connection.pendingReceive.size = remainingData.length;
    } else {
      connection.pendingReceive = undefined;
      // If socket is closed and no more data, clean up connection
      if (!connection.socket) {
        console.error(`[TCPManager] Cleaning up connection ${linkId} - no more pending data`);
        this.connections.delete(linkId);
        this.emit('connectionClosed', linkId);
      }
    }

    return { data: dataToSend, actualLen };
  }

  public getPendingReceiveLength(linkId: number): number {
    const connection = this.connections.get(linkId);
    return connection?.pendingReceive?.size || 0;
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

  public setServerTimeout(timeoutSeconds: number): void {
    this.serverTimeout = timeoutSeconds;
    
    // Apply timeout to existing server connections
    for (const [linkId, connection] of this.connections) {
      if (connection.role === 'server') {
        this.setupConnectionTimeout(linkId, connection);
      }
    }
  }

  private setupConnectionTimeout(linkId: number, connection: TCPConnection): void {
    // Clear existing timeout
    if (connection.timeoutTimer) {
      clearTimeout(connection.timeoutTimer);
    }
    
    // Only set timeout for server connections and if timeout > 0
    if (connection.role === 'server' && this.serverTimeout > 0) {
      connection.lastActivity = Date.now();
      
      connection.timeoutTimer = setTimeout(() => {
        console.error(`[TCPManager] Server connection ${linkId} timed out after ${this.serverTimeout}s of inactivity`);
        this.closeConnection(linkId);
        this.emit('connectionClosed', linkId);
      }, this.serverTimeout * 1000);
    }
  }

  private resetConnectionActivity(linkId: number): void {
    const connection = this.connections.get(linkId);
    if (connection && connection.role === 'server') {
      connection.lastActivity = Date.now();
      this.setupConnectionTimeout(linkId, connection);
    }
  }
}