# ESP8266 AT Modem Simulator

ESP8266 AT command modem simulator written in TypeScript/Node.js with support for multiple connection interfaces:  
 - Serial Port 
 - PIPE (stdin/stdout) (#WIP/not_test) 
 - WebSocket (#WIP/not_test) 

This emulator was made to work together with the Arduino Simulator:  
https://github.com/ricardojlrufino/websim-arduino  

Using this library:    
https://github.com/JAndrassy/WiFiEspAT  


## Features

- **ESP8266 AT command simulation** including WiFi, TCP, and networking commands
- **Multiple connection interfaces**: PIPE, WebSocket, and Serial Port
- **TCP server/client simulation** with multi-connection support
- **WiFi connection simulation** with configurable networks
- **TCP connection management** with up to 4 simultaneous connections
- **SSL** with up to 4 simultaneous connections
- **MQTT**: mqtt client support


## Installation & Usage (NPX)

- Serial
> npx esp8266-modem-simulator serial /dev/tnt0 115200


## Installation from Sources

```bash
# Clone the repository
git clone <repository-url>
cd esp8266-model-simulator

# Install dependencies
yarn install

# Build the project
yarn build

# Install as global
yarn global add file:$PWD

```

## Usage

### Serial Port Interfac
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

### PIPE Interface (Default) - WIP / Not fully tested
Interactive command-line interface using stdin/stdout:

```bash
# Development mode
yarn dev pipe
# or simply
yarn dev

# Production mode
yarn start pipe
```

### WebSocket Interface  - WIP / Not fully tested
WebSocket server for web-based communication (runs on port 3000):

```bash
# Development mode
yarn dev websocket

# Production mode
yarn start websocket
```


## Supported AT Commands

### Basic Commands
- `AT` - Test command
- `AT+RST` - Reset module with boot sequence simulation
- `AT+GMR` - Get firmware version
- `ATE0/ATE1` - Configure AT command echoing

### WiFi Commands (fake/mock)
- `AT+CWMODE=<mode>` - Set WiFi mode (0-3: null mode, station, AP, station+AP)
- `AT+CWMODE?` - Query WiFi mode
- `AT+CWDHCP=<mode>,<en>` - Configure DHCP
- `AT+CWLAP` - List available access points
- `AT+CWJAP="<ssid>","<password>"` - Connect to WiFi network
- `AT+CIFSR` - Get IP and MAC address
- `AT+CIPSTA?` - Query station IP information

### TCP/IP Connection Management
- `AT+CIPMUX=<mode>` - Configure multiple connections (0/1)
- `AT+CIPMUX?` - Query multiple connection mode
- `AT+CIPSERVER=<mode>[,<port>]` - Configure TCP server
- `AT+CIPSTATUS` - Get connection status for all links
- `AT+CIPSTART=<link_id>,"<type>","<remote_IP>",<remote_port>[,<TCP_keep_alive>][,<local_IP>]` - Establish TCP/UDP/SSL connection
- `AT+CIPCLOSE=<link_id>` - Close specific connection

### Data Transmission
- `AT+CIPSEND=<link_id>,<length>` - Send data to connection
- `AT+CIPRECVMODE=1` - Set socket to passive receiving mode
- `AT+CIPRECVLEN?` - Get socket data length in passive mode
- `AT+CIPRECVDATA=<link_id>,<len>` - Obtain socket data in passive mode

### Server Configuration
- `AT+CIPSERVERMAXCONN=<num> (fake)` - Set maximum server connections
- `AT+CIPSTO=<time>` - Set server timeout (0-7200 seconds)
- `AT+CIPSTO?` - Query server timeout

## Default Network Configuration

The simulator includes a pre-configured test network:
- **SSID**: `rede1`
- **Password**: `123456`
- **IP Address**: `127.0.0.1`
- **MAC Address**: `11:22:33:44:55:66`

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


## License

MIT License - see LICENSE file for details.


## Troubleshooting

### Serial Port Issues
- Ensure the serial port exists and has proper permissions
- On Linux, you may need to add your user to the `dialout` group:
  ```bash
  sudo usermod -a -G dialout $USER
  ```
- Restart your session after group changes

## Debug Serial Connections

Use socat and tty0tty to debug real esp hardware 

socat -x -v /dev/ttyUSB0,raw,echo=0,b115200 \
            /dev/tnt0,raw,echo=0,b115200 \
            2>&1 | tee -a serial_traffic_mqtt.log

**Debug simulator**

start simulator on `/dev/tnt0`
connect websim in `/dev/tnt3`

socat -x -v /dev/tnt1,raw,echo=0,b115200 \
            /dev/tnt2,raw,echo=0,b115200 \
            2>&1 | tee -a serial_traffic_mqtt_simulator.log