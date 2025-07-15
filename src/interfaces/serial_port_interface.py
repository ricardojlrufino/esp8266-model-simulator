import serial
import asyncio
import threading
from typing import Optional, List, Dict, Any
import time


class SerialPortInterface:
    def __init__(self, modem, port_path: str, baud_rate: int = 115200):
        self.modem = modem
        self.port_path = port_path
        self.baud_rate = baud_rate
        self.serial_port: Optional[serial.Serial] = None
        self.raw_data_mode = False
        self.raw_data_buffer = bytearray()
        self.expected_data_size = 0
        self.current_link_id = 0
        self.command_buffer = bytearray()
        self._running = False
        self._read_thread: Optional[threading.Thread] = None
        self._main_loop: Optional[asyncio.AbstractEventLoop] = None

    async def start(self) -> None:
        try:
            self._main_loop = asyncio.get_event_loop()
            
            self.serial_port = serial.Serial(
                port=self.port_path,
                baudrate=self.baud_rate,
                timeout=0.05  # Reduced timeout for faster response
            )
            
            self._setup_event_handlers()
            self._running = True
            self._read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._read_thread.start()
            
            print(f"AT Modem Simulator started (Serial interface on {self.port_path} at {self.baud_rate} baud)")
        except Exception as error:
            print(f"Failed to start serial interface: {error}")
            raise error

    def _setup_event_handlers(self) -> None:
        if hasattr(self.modem, 'on_data'):
            self.modem.on_data = self._on_modem_data
        
        if hasattr(self.modem, 'on_waiting_for_data'):
            self.modem.on_waiting_for_data = self._on_waiting_for_data

    def _on_modem_data(self, data: str) -> None:
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.write(data.encode())
            self.serial_port.flush()

    def _on_waiting_for_data(self, link_id: int, size: int) -> None:
        print(f"waitingForData ({link_id},{size})")
        self._start_raw_data_mode(link_id, size)

    def _read_loop(self) -> None:
        while self._running and self.serial_port and self.serial_port.is_open:
            try:
                if self.serial_port.in_waiting > 0:
                    data = self.serial_port.read(self.serial_port.in_waiting)
                    if data:
                        print(f"Serial data received: {len(data)} bytes, rawMode: {self.raw_data_mode}")
                        if self.raw_data_mode:
                            self._handle_raw_data(data)
                        else:
                            # Direct processing to avoid asyncio overhead
                            self._handle_command_data_sync(data)
                # time.sleep(0.001)  # Removed delay for maximum performance
            except Exception as error:
                if self._running:  # Only log if we're still supposed to be running
                    print(f"Serial port error: {error}")
                break

    async def _handle_command_data(self, data: bytes) -> None:
        self.command_buffer.extend(data)
        
        # Look for complete lines ending with \n
        buffer_str = self.command_buffer.decode('utf-8', errors='ignore')
        lines = buffer_str.split('\n')
        
        # Keep the last incomplete line in the buffer
        last_line = lines.pop() if lines else ''
        self.command_buffer = bytearray(last_line.encode('utf-8'))
        
        # Process complete lines
        for line in lines:
            if line.strip():
                print(f"Processing command: {line.strip()}")
                if hasattr(self.modem, 'process_command'):
                    response = await self.modem.process_command(line + '\n')
                elif hasattr(self.modem, 'processCommand'):
                    response = await self.modem.processCommand(line + '\n')
                else:
                    response = None
                
                if response and self.serial_port and self.serial_port.is_open:
                    self.serial_port.write(response.encode() if isinstance(response, str) else response)
                    self.serial_port.flush()

    def _start_raw_data_mode(self, link_id: int, size: int) -> None:
        print(f"Starting raw data mode for linkId {link_id}, expecting {size} bytes")
        self.raw_data_mode = True
        self.current_link_id = link_id
        self.expected_data_size = size
        self.raw_data_buffer = bytearray()

    def _handle_raw_data(self, data: bytes) -> None:
        self.raw_data_buffer.extend(data)
        
        print(f"Raw data received: {len(data)} bytes, total: {len(self.raw_data_buffer)}/{self.expected_data_size}")

        # Process data in chunks as it arrives (like ESP8266 firmware)
        while len(self.raw_data_buffer) > 0 and self.raw_data_mode:
            if len(self.raw_data_buffer) >= self.expected_data_size:
                # Got all expected data
                final_data = self.raw_data_buffer[:self.expected_data_size].decode('utf-8', errors='ignore')
                remaining_data = self.raw_data_buffer[self.expected_data_size:]
                
                print(f"Raw data complete, processing {len(final_data)} bytes")
                
                # Process the complete data packet
                if hasattr(self.modem, 'handle_pending_send'):
                    resp = self.modem.handle_pending_send(self.current_link_id, final_data)
                elif hasattr(self.modem, 'handlePendingSend'):
                    resp = self.modem.handlePendingSend(self.current_link_id, final_data)
                else:
                    resp = None
                    
                if resp and self.serial_port and self.serial_port.is_open:
                    self.serial_port.write(resp.encode() if isinstance(resp, str) else resp)
                    self.serial_port.flush()
                
                # Exit raw mode
                print("Exiting raw data mode")
                self.raw_data_mode = False
                self.raw_data_buffer = bytearray()
                break
            else:
                # Still waiting for more data
                break
            
            # Process any remaining data as commands if present
            if remaining_data:
                # Filter out non-printable characters that cause '?' commands
                filtered_data = bytearray()
                for byte in remaining_data:
                    if byte >= 32 and byte <= 126:  # Only printable ASCII
                        filtered_data.append(byte)
                    elif byte in [10, 13]:  # Allow CR/LF
                        filtered_data.append(byte)
                
                if filtered_data:
                    # Direct processing of remaining data
                    self._handle_command_data_sync(filtered_data)

    def _handle_command_data_sync(self, data: bytes) -> None:
        """Synchronous version of command handling to avoid asyncio overhead"""
        self.command_buffer.extend(data)
        
        # Look for complete lines ending with \n
        buffer_str = self.command_buffer.decode('utf-8', errors='ignore')
        lines = buffer_str.split('\n')
        
        # Keep the last incomplete line in the buffer
        last_line = lines.pop() if lines else ''
        self.command_buffer = bytearray(last_line.encode('utf-8'))
        
        # Process complete lines
        for line in lines:
            if line.strip():
                print(f"Processing command: {line.strip()}")
                # Schedule async processing for modem commands
                if self._main_loop:
                    asyncio.run_coroutine_threadsafe(
                        self._process_single_command(line + '\n'), 
                        self._main_loop
                    )

    async def _process_single_command(self, line: str) -> None:
        """Process a single command asynchronously"""
        if hasattr(self.modem, 'process_command'):
            response = await self.modem.process_command(line)
        elif hasattr(self.modem, 'processCommand'):
            response = await self.modem.processCommand(line)
        else:
            response = None
        
        if response and self.serial_port and self.serial_port.is_open:
            self.serial_port.write(response.encode() if isinstance(response, str) else response)
            self.serial_port.flush()

    async def _process_remaining_data(self, data: bytes) -> None:
        # Process remaining data as commands using the same handler
        await self._handle_command_data(data)

    def stop(self) -> None:
        self._running = False
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()
        if self._read_thread and self._read_thread.is_alive():
            self._read_thread.join(timeout=1.0)

    @staticmethod
    def list_ports() -> List[Dict[str, Any]]:
        import serial.tools.list_ports
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append({
                'device': port.device,
                'name': port.name,
                'description': port.description,
                'hwid': port.hwid,
                'vid': port.vid,
                'pid': port.pid,
                'serial_number': port.serial_number,
                'location': port.location,
                'manufacturer': port.manufacturer,
                'product': port.product,
                'interface': port.interface
            })
        return ports