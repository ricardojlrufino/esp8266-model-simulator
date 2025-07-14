import * as net from 'net';

export interface ModemState {
  wifiConnected: boolean;
  cwMode: number;
  cipMode: number;
  cipMux: number;
  cipServer: number;
  port: number;
  ssid: string;
  password: string;
  ip: string;
  mac: string;
  connections: net.Socket[];
  serverSocket: net.Server | null;
  pendingSend?: {
    linkId: number;
    pkgSize: number;
    received: number;
    buffer: string;
  };
  pendingReceive?: {
    linkId: number;
    size: number;
    buffer: string;
  };
}