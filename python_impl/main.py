#!/usr/bin/env python3

import sys
import asyncio
import signal
from typing import Optional
from at_modem_simulator import ATModemSimulator
from interfaces.serial_port_interface import SerialPortInterface


class ATModemApp:
    def __init__(self):
        self.modem = ATModemSimulator()
        self.serial_interface: Optional[SerialPortInterface] = None

    async def start(self):
        args = sys.argv[1:]
        conn_type = args[0] if args else 'serial'

        if conn_type == 'serial':
            port_path = args[1] if len(args) > 1 else None
            baud_rate = int(args[2]) if len(args) > 2 else 115200

            if not port_path:
                print('Available serial ports:')
                ports = SerialPortInterface.list_ports()
                for port in ports:
                    manufacturer = port.get('manufacturer', 'Unknown')
                    print(f"  {port['device']} - {manufacturer}")
                print('\nUsage: python main.py serial <port_path> [baud_rate]')
                print('Example: python main.py serial /dev/ttyUSB0 115200')
                sys.exit(1)

            self.serial_interface = SerialPortInterface(self.modem, port_path, baud_rate)
            try:
                await self.serial_interface.start()
            except Exception as error:
                print(f'Failed to start serial interface: {error}')
                sys.exit(1)
        else:
            print(f"Connection type '{conn_type}' not implemented in Python version")
            print("Only 'serial' connection type is available")
            sys.exit(1)

        # Setup signal handlers for graceful shutdown
        def signal_handler(signum, frame):
            print('\nShutting down...')
            if self.serial_interface:
                self.serial_interface.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        # Keep the main thread alive
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print('\nShutting down...')
            if self.serial_interface:
                self.serial_interface.stop()


async def main():
    app = ATModemApp()
    await app.start()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nShutting down...')
        sys.exit(0)
    except Exception as e:
        print(f'Error: {e}')
        sys.exit(1)