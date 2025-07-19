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
  cipsto: number;
}