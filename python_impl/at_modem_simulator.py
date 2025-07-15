import asyncio
import socket
import threading
import time
import re
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, field


@dataclass
class PendingSend:
    link_id: int
    pkg_size: int
    received: int
    buffer: str


@dataclass
class PendingReceive:
    link_id: int
    size: int
    buffer: str


@dataclass
class ModemState:
    wifi_connected: bool = False
    cw_mode: int = 1  # Station mode (client)
    cip_mode: int = 0
    cip_mux: int = 0
    cip_server: int = 0
    port: int = 0
    ssid: str = ''
    password: str = ''
    ip: str = '127.0.0.1'
    mac: str = '11:22:33:44:55:66'
    connections: List[socket.socket] = field(default_factory=list)
    server_socket: Optional[socket.socket] = None
    pending_send: Optional[PendingSend] = None
    pending_receive: Optional[PendingReceive] = None


MAX_CONNECTIONS = 4


class ATModemSimulator:
    def __init__(self):
        self.state = ModemState()
        self.command_buffer = ''
        self.tcp_server: Optional[socket.socket] = None
        self._running = False
        self._server_thread: Optional[threading.Thread] = None
        
        # Event handlers
        self.on_data: Optional[Callable[[str], None]] = None
        self.on_waiting_for_data: Optional[Callable[[int, int], None]] = None

    def emit(self, event: str, *args):
        """Simple event emitter"""
        if event == 'data' and self.on_data:
            self.on_data(args[0])
        elif event == 'waitingForData' and self.on_waiting_for_data:
            self.on_waiting_for_data(args[0], args[1])

    async def process_command(self, data: str) -> Optional[str]:
        self.command_buffer += data
        responses = []

        # Process commands terminated with \r\n
        lines = self.command_buffer.split('\r\n')
        self.command_buffer = lines.pop() if lines else ''

        for line in lines:
            if line.strip():
                response = await self.execute_command(line.strip())
                if response:
                    responses.append(response)

        return ''.join(responses) if responses else None

    async def execute_command(self, cmd: str) -> str:
        # print(f"Executing command: {cmd}")  # Disabled for performance
        
        response = '\r\n\r\nERROR\r\n'

        # Basic AT command
        if cmd == 'AT':
            response = '\r\n\r\nOK\r\n'

        # Modem reset
        elif cmd == 'AT+RST':
            response = '\r\n\r\nOK\r\n'
            self.reset_modem()
            
            # Simulate ESP8266 boot sequence
            def send_boot_sequence():
                # time.sleep(0.5)
                boot_msg = ('WIFI DISCONNECT\r\n\r\n' +
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
                          'ready\r\n')
                self.emit('data', boot_msg)
            
            threading.Timer(0.5, send_boot_sequence).start()

        # Firmware version
        elif cmd == 'AT+GMR':
            response = ('\r\nAT version:0.51.0.0(Nov 27 2015 13:37:21)\r\n' +
                       'SDK version:1.5.0\r\n' +
                       'compile time:Nov 27 2015 13:58:02\r\n' +
                       '\r\nOK\r\n')

        # Configure WiFi mode
        elif cmd.startswith('AT+CWMODE='):
            try:
                mode = int(cmd.split('=')[1])
                if 0 <= mode <= 3:
                    self.state.cw_mode = mode
                    response = '\r\n\r\nOK\r\n'
            except (ValueError, IndexError):
                pass

        # Query WiFi mode
        elif cmd == 'AT+CWMODE?':
            response = f'\r\n+CWMODE:{self.state.cw_mode}\r\n\r\nOK\r\n'

        # Configure DHCP
        elif cmd.startswith('AT+CWDHCP='):
            response = '\r\n\r\nOK\r\n'

        # List access points
        elif cmd == 'AT+CWLAP':
            if self.state.cw_mode != 2:
                response = ('\r\n' +
                          '+CWLAP:(4,"rede1",-91,"30:b5:c2:2b:58:de",1)\r\n' +
                          '+CWLAP:(0,"netmail12",-88,"00:0c:42:18:c6:4c",2)\r\n' +
                          '+CWLAP:(0,"netmail10",-91,"00:0c:42:1f:1d:81",7)\r\n' +
                          '+CWLAP:(0,"netmail11",-84,"00:0c:42:1f:73:2e",9)\r\n' +
                          '\r\nOK\r\n')
            else:
                print("Invalid CWMODE")

        elif cmd == 'AT+CIPSTA?':
            if self.state.cw_mode != 2:
                response = ('\r\n' +
                          '+CIPSTA:ip:192.168.0.2\r\n' +
                          '+CIPSTA:gateway:192.168.0.1\r\n' +
                          '+CIPSTA:netmask:255.255.255.0\r\n' +
                          '\r\nOK\r\n')
            else:
                print("Invalid CWMODE")

        # Connect to AP
        elif cmd.startswith('AT+CWJAP='):
            if self.state.cw_mode != 2:
                # Handle both quote styles
                match = re.search(r'AT\+CWJAP=[""]([^""]+)[""],[""]([^""]+)[""]', cmd) or \
                        re.search(r'AT\+CWJAP="([^"]+)","([^"]+)"', cmd)
                if match:
                    self.state.ssid = match.group(1)
                    self.state.password = match.group(2)
                    self.state.wifi_connected = True
                    response = ('\r\n\r\nWIFI CONNECTED\r\n' +
                              'WIFI GOT IP\r\n' +
                              '\r\nOK\r\n')
                else:
                    print("No match for CWJAP command")
            else:
                print("Invalid CWMODE")

        # Get IP
        elif cmd == 'AT+CIFSR':
            if self.state.wifi_connected:
                response = (f'\r\n+CIFSR:STAIP,"{self.state.ip}"\r\n' +
                           f'+CIFSR:STAMAC,"{self.state.mac}"\r\n' +
                           '\r\nOK\r\n')

        # Configure multiple connections
        elif cmd.startswith('AT+CIPMUX='):
            if self.state.cip_server == 0 and self.state.cip_mode == 0:
                try:
                    self.state.cip_mux = int(cmd.split('=')[1])
                    response = '\r\n\r\nOK\r\n'
                except (ValueError, IndexError):
                    pass

        # Query multiple connections
        elif cmd == 'AT+CIPMUX?':
            response = f'\r\n+CIPMUX:{self.state.cip_mux}\r\n\r\nOK\r\n'

        # Configure TCP server
        elif cmd.startswith('AT+CIPSERVER='):
            try:
                params = cmd.split('=')[1].split(',')
                new_cip_server = int(params[0])
                new_port = int(params[1])

                if new_cip_server == 1:
                    self.state.port = new_port
                    try:
                        server_result = await self.start_tcp_server()
                        if server_result:
                            self.state.cip_server = new_cip_server
                            response = 'OK\r\n'
                        else:
                            self.state.cip_server = 0
                            response = 'ERROR\r\n'
                    except Exception as error:
                        print(f"Error starting TCP server: {error}")
                        self.state.cip_server = 0
                        response = 'ERROR\r\n'
                else:
                    self.stop_tcp_server()
                    self.state.cip_server = 0
                    response = 'OK\r\n'
            except (ValueError, IndexError):
                pass

        # Connection status
        elif cmd == 'AT+CIPSTATUS':
            if len(self.state.connections) > 0 and any(conn for conn in self.state.connections):
                response = "\r\nSTATUS:3\r\n"
                # Show actual connections
                for i, conn in enumerate(self.state.connections):
                    if conn:
                        response += f'+CIPSTATUS:{i},"TCP","192.168.0.31",53116,2000,1\r\n'
            else:
                response = "\r\nSTATUS:2\r\n"
            
            response += '\r\nOK\r\n'

        # Configure AT Commands Echoing
        elif cmd in ['ATE0', 'ATE1']:
            response = 'OK\r\n'

        # Set Socket Receiving Mode
        elif cmd.startswith('AT+CIPRECVMODE=1'):
            response = 'OK\r\n'

        # Obtain Socket Data Length in Passive Receiving Mode
        elif cmd.startswith('AT+CIPRECVLEN?'):
            length = self.state.pending_receive.size if self.state.pending_receive else 0
            response = f'\r\n+CIPRECVLEN:{length},0,0,0,0\r\n\r\nOK\r\n'

        # Obtain Socket Data in Passive Receiving Mode
        elif cmd.startswith('AT+CIPRECVDATA='):
            try:
                params = cmd.split('=')[1].split(',')
                link_id = int(params[0])
                requested_len = int(params[1])

                if self.state.pending_receive:
                    available_data = self.state.pending_receive.buffer
                    actual_len = min(requested_len, len(available_data))
                    data_to_send = available_data[:actual_len]
                    remaining_data = available_data[actual_len:]

                    response = (f'\r\n\r\n+CIPRECVDATA,{actual_len}:{data_to_send}\r\n' +
                              '\r\nOK\r\n')

                    print(f"Send [{actual_len}] {data_to_send}")

                    if remaining_data:
                        self.state.pending_receive.buffer = remaining_data
                        self.state.pending_receive.size = len(remaining_data)
                    else:
                        self.state.pending_receive = None
                else:
                    print("Send DONE... +CIPRECVDATA:0...")
                    response = '+CIPRECVDATA:0,192.168.0.2,8080,\r\nOK\r\n'
            except (ValueError, IndexError):
                pass

        # Set the Maximum Connections Allowed by a Server
        elif cmd.startswith('AT+CIPSERVERMAXCONN='):
            response = 'OK\r\n'

        # Set server timeout
        elif cmd.startswith('AT+CIPSTO='):
            response = 'OK\r\n'

        # Send data
        elif cmd.startswith('AT+CIPSEND='):
            try:
                params = cmd.split('=')[1].split(',')
                link_id = 0
                size = 0

                if self.state.cip_mux == 1:
                    link_id = int(params[0])
                    size = int(params[1])
                else:
                    size = int(params[0])

                if size > 2048:
                    print("##### WARNING - DATA TRUNCATED AT: 2048 bytes.")
                    size = 2048

                if link_id < len(self.state.connections) and self.state.connections[link_id]:
                    if self.state.pending_send:
                        self.state.pending_send.pkg_size = size
                        self.state.pending_send.received = 0
                    else:
                        self.state.pending_send = PendingSend(
                            link_id=link_id,
                            pkg_size=size,
                            received=0,
                            buffer=''
                        )

                    self.emit('waitingForData', link_id, size)
                    response = '\r\n\r\nOK\r\n> '
 #               else:
                    # print(f"ERROR: No connection at linkId: {link_id}")  # Disabled for performance
            except (ValueError, IndexError):
                pass

        # Close connection
        elif cmd.startswith('AT+CIPCLOSE='):
            try:
                # print("Received command CLOSE, write buffer if exist")  # Disabled for performance
                link_id = int(cmd.split('=')[1])
                if link_id < len(self.state.connections) and self.state.connections[link_id]:
                    if self.state.pending_send:
                        pending = self.state.pending_send
                        self.state.pending_send = None
                        try:
                            self.state.connections[link_id].send(pending.buffer.encode())
                            print(f"Send to TCP Client (on flush):\n{pending.buffer.strip()}")
                        except Exception:
                            pass
                        finally:
                            self.state.connections[link_id].close()
                            self.state.connections[link_id] = None
                    else:
                        self.state.connections[link_id].close()
                        self.state.connections[link_id] = None

                    response = f'\r\n{link_id},CLOSED\r\n\r\nOK\r\n'
            except (ValueError, IndexError):
                pass

        # if response:
        #     print(f"Command Response:\r\n{response}")  # Disabled for performance

        return response

    def reset_modem(self):
        self.state.wifi_connected = False
        self.state.cip_server = 0
        self.state.port = 0
        self.state.cip_mux = 0
        self.state.cip_mode = 0
        self.state.ssid = ''
        self.state.password = ''
        self.state.pending_send = None
        
        self.stop_tcp_server()
        self.close_all_connections()

    async def start_tcp_server(self) -> bool:
        if self.tcp_server:
            self.tcp_server.close()

        # Check if port is available
        is_available = await self.is_port_available(self.state.port)
        if not is_available:
            print(f"Port {self.state.port} is already in use")
            return False

        try:
            self.tcp_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.tcp_server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.tcp_server.bind(('127.0.0.1', self.state.port))
            self.tcp_server.listen(MAX_CONNECTIONS)
            
            self._running = True
            self._server_thread = threading.Thread(target=self._server_loop, daemon=True)
            self._server_thread.start()
            
            print(f"TCP server listening on port {self.state.port}")
            return True
        except Exception as error:
            print(f"Failed to create TCP server: {error}")
            return False

    def _server_loop(self):
        while self._running and self.tcp_server:
            try:
                self.tcp_server.settimeout(0.1)  # Faster timeout
                client_socket, address = self.tcp_server.accept()
                
                # Find free slot for connection
                link_id = -1
                for i in range(MAX_CONNECTIONS):
                    if i >= len(self.state.connections):
                        self.state.connections.extend([None] * (i + 1 - len(self.state.connections)))
                    if not self.state.connections[i]:
                        link_id = i
                        break

                if link_id != -1:
                    self.state.connections[link_id] = client_socket
                    self.emit('data', f'{link_id},CONNECT\r\n\r\n')
                    
                    # Handle client in separate thread
                    client_thread = threading.Thread(
                        target=self._handle_client,
                        args=(client_socket, link_id),
                        daemon=True
                    )
                    client_thread.start()
                else:
                    client_socket.close()
                    
            except socket.timeout:
                continue
            except Exception as e:
                if self._running:
                    print(f"Server error: {e}")
                break

    def _handle_client(self, client_socket: socket.socket, link_id: int):
        try:
            while self._running:
                try:
                    client_socket.settimeout(0.1)  # Faster timeout
                    data = client_socket.recv(1024)
                    if not data:
                        # Client disconnected gracefully
                        # print(f"Client {link_id} disconnected")  # Disabled for performance
                        break
                    
                    send_later = True
                    if send_later:
                        # print(f"TCPSocket Received ({len(data)}):\r\n{data.decode()}")  # Disabled for performance
                        self.emit('data', f'+IPD,{link_id},{len(data)}\r\n')
                        
                        if not self.state.pending_receive:
                            self.state.pending_receive = PendingReceive(
                                link_id=link_id,
                                size=len(data),
                                buffer=data.decode()
                            )
 #                       else:
                            # print("WARNING... pendingReceive and has new request. This may be a bug")  # Disabled for performance
                    else:
                        response = f'+IPD,{link_id},{len(data)}:{data.decode()}\r\n'
                        self.emit('data', response)
                        # print(f"Socket Received ({len(data)}): {data.decode()}")
                        # print(f"Send Response: {response}")  # Disabled for performance
                        
                except socket.timeout:
                    # Timeout is normal, continue the loop
                    continue
                except ConnectionResetError:
                    # print(f"Client {link_id} reset connection")  # Disabled for performance
                    break
                except Exception as e:
                    # print(f"Client handler error: {e}")  # Disabled for performance
                    break
                    
        except Exception as e:
            print(f"Client handler outer error: {e}")  # Disabled for performance
        finally:
            if link_id < len(self.state.connections):
                self.state.connections[link_id] = None
            try:
                client_socket.close()
            except:
                pass
            # print(f"Connection {link_id} closed...")  # Disabled for performance

    async def is_port_available(self, port: int) -> bool:
        try:
            test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            test_socket.bind(('127.0.0.1', port))
            test_socket.close()
            return True
        except OSError:
            return False

    def stop_tcp_server(self):
        self._running = False
        if self.tcp_server:
            self.tcp_server.close()
            self.tcp_server = None
        if self._server_thread and self._server_thread.is_alive():
            self._server_thread.join(timeout=1.0)
        self.close_all_connections()

    def close_all_connections(self):
        for i in range(len(self.state.connections)):
            if self.state.connections[i]:
                try:
                    self.state.connections[i].close()
                except:
                    pass
                self.state.connections[i] = None

    def handle_pending_send(self, link_id: int, data: str) -> Optional[str]:
        if not self.state.pending_send:
            return None

        pending = self.state.pending_send
        
        # Accumulate data fragments like ESP8266 firmware
        pending.buffer += data
        pending.received += len(data)
        
        # print(f"CIPSEND - Received data [length:{len(data)}, read:{pending.received - len(data)}, remaining:{pending.pkg_size - pending.received}]:\r\n{data}")  # Disabled for performance

        # ESP8266 AT 1.7 behavior: Send data immediately when complete
        if pending.received >= pending.pkg_size:
            # Send accumulated data to TCP connection immediately
            if link_id < len(self.state.connections) and self.state.connections[link_id]:
                try:
                    self.state.connections[link_id].send(pending.buffer.encode())
                    # print(f"Send to TCP Client:\n{pending.buffer.strip()}")  # Disabled for performance
                except Exception as e:
                    print(f"Error sending data: {e}")  # Disabled for performance

            # Clear pending send state and respond immediately
            self.state.pending_send = None
            return f'\r\nRecv {pending.pkg_size} bytes\r\n\r\nSEND OK\r\n'
        
        # Still accumulating data - no delay, just wait for more
        return None

    def send_data(self, link_id: int, data: str):
        if link_id < len(self.state.connections) and self.state.connections[link_id]:
            try:
                self.state.connections[link_id].send(data.encode())
                self.emit('data', f'\r\nRecv {len(data)} bytes\r\n')
                self.emit('data', 'SEND OK\r\n')
            except Exception as e:
                print(f"Error sending data: {e}")

    def get_state(self) -> ModemState:
        return self.state