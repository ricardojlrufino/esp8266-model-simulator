# ESP8266 AT Modem Simulator

A comprehensive ESP8266 AT command modem simulator written in TypeScript/Node.js with support for multiple connection interfaces: PIPE (stdin/stdout), WebSocket, and Serial Port.

## Features

- **Complete ESP8266 AT command simulation** including WiFi, TCP, and networking commands
- **Multiple connection interfaces**: PIPE, WebSocket, and Serial Port
- **Real-time TCP server simulation** with multi-connection support
- **WebSocket interface** for web-based integration
- **Serial port interface** for hardware simulation
- **Boot sequence simulation** including ESP8266 startup messages
- **WiFi connection simulation** with configurable networks
- **TCP connection management** with up to 4 simultaneous connections

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd esp8266-model-simulator

# Install dependencies
yarn install

# Build the project
yarn build
```

## Usage

### PIPE Interface (Default)
Interactive command-line interface using stdin/stdout:

```bash
# Development mode
yarn dev pipe
# or simply
yarn dev

# Production mode
yarn start pipe
```

### WebSocket Interface
WebSocket server for web-based communication (runs on port 3000):

```bash
# Development mode
yarn dev websocket

# Production mode
yarn start websocket
```

### Serial Port Interface
Serial port communication interface:

```bash
# List available serial ports
yarn dev serial

# Connect to specific port with default baud rate (115200)
yarn dev serial /dev/ttyUSB0

# Connect with custom baud rate
yarn dev serial /dev/ttyUSB0 9600

# Production mode
yarn start serial /dev/ttyUSB0 115200
```

## Supported AT Commands

### Basic Commands
- `AT` - Test command
- `AT+RST` - Reset module with boot sequence simulation
- `AT+GMR` - Get firmware version

### WiFi Commands
- `AT+CWMODE=<mode>` - Set WiFi mode (0-3)
- `AT+CWMODE?` - Query WiFi mode
- `AT+CWDHCP=<mode>,<en>` - Configure DHCP
- `AT+CWLAP` - List available access points
- `AT+CWJAP="<ssid>","<password>"` - Connect to WiFi network
- `AT+CIFSR` - Get IP and MAC address

### TCP/IP Commands
- `AT+CIPMUX=<mode>` - Configure multiple connections (0/1)
- `AT+CIPMUX?` - Query multiple connection mode
- `AT+CIPSERVER=<mode>[,<port>]` - Configure TCP server
- `AT+CIPSTATUS` - Get connection status
- `AT+CIPSEND=<link_id>,<length>` - Send data
- `AT+CIPCLOSE=<link_id>` - Close connection

## Default Network Configuration

The simulator includes a pre-configured test network:
- **SSID**: `rede1`
- **Password**: `123456`
- **IP Address**: `127.0.0.1`
- **MAC Address**: `11:22:33:44:55:66`

## Connection Interfaces

### PipeInterface
- Uses Node.js readline for interactive command input
- Outputs responses directly to stdout
- Ideal for command-line testing and debugging

### WebSocketInterface
- Socket.IO server on port 3000
- CORS enabled for cross-origin requests
- Events: `command`, `response`, `sendData`, `getState`, `waitingForData`
- Perfect for web applications and browser-based tools

### SerialPortInterface
- Real serial port communication using the `serialport` library
- Configurable baud rate (default: 115200)
- Automatic port discovery and listing
- Hardware-compatible for embedded system testing

## API

### ATModemSimulator Class

The core simulator class that processes AT commands and manages state:

```typescript
const simulator = new ATModemSimulator();

// Process AT command
const response = simulator.processCommand('AT\r\n');

// Send data to TCP connection
simulator.sendData(linkId, data);

// Get current state
const state = simulator.getState();
```

### Events

The simulator emits the following events:

- `data` - Asynchronous responses (boot messages, connection status)
- `waitingForData` - When simulator is waiting for data input after CIPSEND

## TCP Server Simulation

When TCP server mode is enabled (`AT+CIPSERVER=1,<port>`):

- Accepts up to 4 simultaneous connections
- Automatically assigns link IDs (0-3)
- Emits connection events: `<id>,CONNECT` and `<id>,CLOSED`
- Forwards received data as `+IPD,<id>,<length>:<data>`

## Example Usage

### Basic AT Commands
```
AT
OK

AT+CWMODE=1
OK

AT+CWJAP="rede1","123456"
WIFI CONNECTED
WIFI GOT IP
OK

AT+CIFSR
+CIFSR:STAIP,"127.0.0.1"
+CIFSR:STAMAC,"11:22:33:44:55:66"
OK
```

### TCP Server Setup
```
AT+CIPMUX=1
OK

AT+CIPSERVER=1,8080
OK

# When client connects:
0,CONNECT

# When client sends data:
+IPD,0,5:hello
```

## Dependencies

- **Node.js** (v14 or higher)
- **TypeScript** for development
- **socket.io** for WebSocket interface
- **serialport** for Serial Port interface

## Development

```bash
# Install dependencies
yarn install

# Development mode with auto-reload
yarn dev [interface] [options]

# Build TypeScript
yarn build

# Run built version
yarn start [interface] [options]
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Troubleshooting

### Serial Port Issues
- Ensure the serial port exists and has proper permissions
- On Linux, you may need to add your user to the `dialout` group:
  ```bash
  sudo usermod -a -G dialout $USER
  ```
- Restart your session after group changes

### WebSocket Connection Issues
- Check that port 3000 is not in use by another application
- Verify firewall settings allow connections on port 3000

### Common AT Command Issues
- Ensure commands end with `\r\n`
- WiFi connection only works with the pre-configured network (`rede1`/`123456`)
- TCP server requires `CIPMUX=1` to be set first