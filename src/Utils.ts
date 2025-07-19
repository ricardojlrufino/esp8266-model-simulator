export class Utils{
    static hexDump(data: string | Buffer, bytesPerLine: number = 16): string {
        const lines: string[] = [];
        
        // Convert to Buffer if it's a string
        const buffer = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;

        for (let i = 0; i < buffer.length; i += bytesPerLine) {
            const chunk = buffer.subarray(i, i + bytesPerLine);

            // Offset em hexadecimal
            const offset: string = i.toString(16).padStart(8, '0').toUpperCase();

            // Bytes em hexadecimal
            const hexBytes: string = Array.from(chunk)
                .map((byte: number) => byte.toString(16).padStart(2, '0').toUpperCase())
                .join(' ')
                .padEnd(bytesPerLine * 3 - 1, ' ');

            // Caracteres ASCII legíveis
            const asciiChars: string = Array.from(chunk)
                .map((byte: number) => {
                    return (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                })
                .join('');

            lines.push(`${offset}: ${hexBytes} |${asciiChars}|`);
        }

        return lines.join('\n');
    };
}