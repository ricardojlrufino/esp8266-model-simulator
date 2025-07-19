#!/usr/bin/env node

const { SerialPort } = require('serialport');

class ATCommandTester {
    constructor(portPath = '/dev/ttyUSB0', baudRate = 115200) {
        this.portPath = portPath;
        this.baudRate = baudRate;
        this.port = null;
        this.responseBuffer = '';
        this.commandQueue = [];
        this.isWaiting = false;
    }

    log(direction, data) {
        const timestamp = new Date().toLocaleTimeString();
        const arrow = direction === 'send' ? '→' : '←';
        console.log(`[${timestamp}] ${arrow} ${data.trim()}`);
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.port = new SerialPort({
                path: this.portPath,
                baudRate: this.baudRate,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                flowControl: false
            });

            this.port.on('open', () => {
                console.log(`Conectado à porta serial ${this.portPath} @ ${this.baudRate} baud`);
                resolve();
            });

            this.port.on('data', (data) => {
                const response = data.toString();
                this.responseBuffer += response;
                this.log('receive', response);
            });

            this.port.on('error', (err) => {
                console.error('Erro na porta serial:', err.message);
                reject(err);
            });
        });
    }

    async sendCommand(command, timeout = 2000) {
        return new Promise((resolve, reject) => {
            this.responseBuffer = '';
            this.isWaiting = true;

            this.port.write(command + '\r\n', (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                this.log('send', command);
            });

            const timeoutId = setTimeout(() => {
                this.isWaiting = false;
                resolve(this.responseBuffer);
            }, timeout);

            const checkResponse = () => {
                if (this.responseBuffer.includes('OK') || 
                    this.responseBuffer.includes('ERROR') ||
                    this.responseBuffer.includes('ready')) {
                    clearTimeout(timeoutId);
                    this.isWaiting = false;
                    resolve(this.responseBuffer);
                } else if (this.isWaiting) {
                    setTimeout(checkResponse, 100);
                }
            };

            checkResponse();
        });
    }

    async waitForEvent(eventText, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkEvent = () => {
                if (this.responseBuffer.includes(eventText)) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout esperando por: ${eventText}`));
                } else {
                    setTimeout(checkEvent, 100);
                }
            };

            checkEvent();
        });
    }

    async runCompleteTest() {
        try {
            await this.connect();
            
            console.log('\n=== Executando sequência completa do log ===\n');

            // 1. Reset do módulo
            console.log('1. Resetando módulo...');
            await this.sendCommand('AT+RST', 5000);
            
            // Aguardar boot completo
            await this.waitForEvent('ready', 10000);
            console.log('Módulo pronto após reset');

            // 2. Desabilitar echo
            console.log('\n2. Desabilitando echo...');
            await this.sendCommand('ATE0');

            // 3. Configurar múltiplas conexões
            console.log('\n3. Configurando múltiplas conexões...');
            await this.sendCommand('AT+CIPMUX=1');

            // 4. Configurar modo de recepção
            console.log('\n4. Configurando modo de recepção...');
            await this.sendCommand('AT+CIPRECVMODE=1');

            // 5. Verificar modo WiFi
            console.log('\n5. Verificando modo WiFi...');
            await this.sendCommand('AT+CWMODE?');

            // 6. Monitorar status de conexão
            console.log('\n6. Monitorando status de conexão...');
            for (let i = 0; i < 6; i++) {
                await this.sendCommand('AT+CIPSTATUS');
                await this.sleep(1000);
                
                if (this.responseBuffer.includes('STATUS:2')) {
                    console.log('WiFi conectado!');
                    break;
                }
            }

            // 7. Estabelecer conexão TCP
            console.log('\n7. Estabelecendo conexão TCP...');
            await this.sendCommand('AT+CIPSTART=4,"TCP","arduino.tips",80', 5000);

            // 8. Enviar requisição HTTP
            console.log('\n8. Enviando requisição HTTP...');
            await this.sendHttpRequest();

            // 9. Receber resposta
            console.log('\n9. Recebendo resposta...');
            await this.receiveHttpResponse();

            console.log('\n=== Teste concluído ===');

        } catch (error) {
            console.error('Erro durante o teste:', error.message);
        } finally {
            if (this.port && this.port.isOpen) {
                this.port.close();
            }
        }
    }

    async sendHttpRequest() {
        // Primeira parte
        await this.sendCommand('AT+CIPSEND=4,32');
        await this.sleep(500);
        await this.sendCommand('GET /asciilogo.txt HTTP/1.1\r\nHos');

        // Segunda parte
        await this.sendCommand('AT+CIPSEND=4,32');
        await this.sleep(500);
        await this.sendCommand('t: arduino.tips\r\nConnection: clo');

        // Terceira parte
        await this.sendCommand('AT+CIPSEND=4,6');
        await this.sleep(500);
        await this.sendCommand('se\r\n\r\n');
    }

    async receiveHttpResponse() {
        // Verificar status
        await this.sendCommand('AT+CIPSTATUS');
        
        // Verificar dados disponíveis
        await this.sendCommand('AT+CIPRECVLEN?');

        // Receber dados em blocos
        for (let i = 0; i < 20; i++) {
            try {
                await this.sendCommand('AT+CIPRECVDATA=4,32', 1000);
                await this.sleep(200);
                
                if (this.responseBuffer.includes('CLOSED')) {
                    console.log('Conexão fechada pelo servidor');
                    break;
                }
            } catch (error) {
                console.log('Fim da recepção ou timeout');
                break;
            }
        }
    }

    async runBasicTest() {
        try {
            await this.connect();
            
            console.log('\n=== Teste básico de comandos AT ===\n');

            const basicCommands = [
                'AT',
                'AT+GMR',
                'ATE0',
                'AT+CWMODE?',
                'AT+CIPSTATUS'
            ];

            for (const cmd of basicCommands) {
                console.log(`Enviando: ${cmd}`);
                await this.sendCommand(cmd);
                await this.sleep(500);
            }

            console.log('\n=== Teste básico concluído ===');

        } catch (error) {
            console.error('Erro durante o teste:', error.message);
        } finally {
            if (this.port && this.port.isOpen) {
                this.port.close();
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    disconnect() {
        if (this.port && this.port.isOpen) {
            this.port.close();
        }
    }
}

// Executar o teste
if (require.main === module) {
    const args = process.argv.slice(2);
    const portPath = args[0] || '/dev/tnt1';
    const testType = args[1] || 'full';
    
    console.log(`Usando porta: ${portPath}`);
    console.log(`Tipo de teste: ${testType}`);
    
    const tester = new ATCommandTester(portPath);
    
    if (testType === 'full') {
        tester.runCompleteTest();
    } else {
        tester.runBasicTest();
    }
}

module.exports = ATCommandTester;