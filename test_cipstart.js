const { ATModemSimulator } = require('./dist/ATModemSimulator.js');

async function testCIPSTART() {
  const modem = new ATModemSimulator();
  
  // Setup event listeners
  modem.on('data', (data) => {
    console.log('Modem output:', data.replace(/\r\n/g, '\\r\\n'));
  });
  
  console.log('Testing AT+CIPSTART command...\n');
  
  // Test basic AT command
  console.log('=== Testing AT ===');
  let response = await modem.processCommand('AT\r\n');
  console.log('Response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Set multiple connection mode
  console.log('\n=== Setting CIPMUX=1 ===');
  response = await modem.processCommand('AT+CIPMUX=1\r\n');
  console.log('Response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Test TCP connection
  console.log('\n=== Testing TCP connection ===');
  response = await modem.processCommand('AT+CIPSTART=0,"TCP","www.google.com",80\r\n');
  console.log('Response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Test UDP connection
  console.log('\n=== Testing UDP connection ===');
  response = await modem.processCommand('AT+CIPSTART=1,"UDP","8.8.8.8",53\r\n');
  console.log('Response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Check connection status
  console.log('\n=== Checking connection status ===');
  response = await modem.processCommand('AT+CIPSTATUS\r\n');
  console.log('Response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Test error cases
  console.log('\n=== Testing error cases ===');
  
  // Invalid parameters
  response = await modem.processCommand('AT+CIPSTART=0\r\n');
  console.log('Invalid params response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Already connected
  response = await modem.processCommand('AT+CIPSTART=0,"TCP","www.google.com",80\r\n');
  console.log('Already connected response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  // Single connection mode
  console.log('\n=== Testing single connection mode ===');
  await modem.processCommand('AT+RST\r\n');
  await new Promise(resolve => setTimeout(resolve, 100));
  response = await modem.processCommand('AT+CIPSTART="TCP","www.google.com",80\r\n');
  console.log('Single mode response:', response?.replace(/\r\n/g, '\\r\\n'));
  
  console.log('\nTest completed!');
}

testCIPSTART().catch(console.error);