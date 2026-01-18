/**
 * ============================================================
 *  TTN / LoRaWAN Downlink Formatter for Heltec-HRI-4851L to Modbus Devices
 * ============================================================
 *
 *  This function converts a JSON object into a Modbus RTU
 *  downlink payload. The output is a byte array that TTN/TTS
 *  will transmit to the LoRaWAN device.
 *
 *  Supported Modbus function codes:
 *
 *    0x06  (Write Single Register)
 *    0x10  (Write Multiple Registers)
 *
 *  The formatter is intentionally simple and generic so that
 *  it can be used with any Modbus device without requiring
 *  device‑specific mappings.
 *
 * ------------------------------------------------------------
 *  INPUT FORMAT (JSON)
 * ------------------------------------------------------------
 *
 *  {
 *    "slaveAddress": 1,      // Modbus slave ID (0–247)
 *    "functionCode": 6,      // 6 or 16
 *    "register": 0,          // Register index (0-based)
 *    "values": [1234]        // Array of register values
 *  }
 *
 *  Notes:
 *    - For function 0x06, only the first value in "values" is used.
 *    - For function 0x10, all values are written sequentially.
 *
 * ------------------------------------------------------------
 *  OUTPUT FORMAT (TTN)
 * ------------------------------------------------------------
 *
 *  {
 *    "bytes": [ ... ]        // Array of bytes to send
 *  }
 *
 *  TTN will transmit these bytes as the LoRaWAN downlink payload.
 *
 * ------------------------------------------------------------
 *  MODBUS WRITE SINGLE REGISTER (0x06)
 * ------------------------------------------------------------
 *
 *  Frame structure:
 *
 *    Byte 0 : Slave address
 *    Byte 1 : Function code (0x06)
 *    Byte 2 : Register address (high byte)
 *    Byte 3 : Register address (low byte)
 *    Byte 4 : Register value (high byte)
 *    Byte 5 : Register value (low byte)
 *
 * ------------------------------------------------------------
 *  MODBUS WRITE MULTIPLE REGISTERS (0x10)
 * ------------------------------------------------------------
 *
 *  Frame structure:
 *
 *    Byte 0 : Slave address
 *    Byte 1 : Function code (0x10)
 *    Byte 2 : Register address (high byte)
 *    Byte 3 : Register address (low byte)
 *    Byte 4 : Number of registers (high byte)
 *    Byte 5 : Number of registers (low byte)
 *    Byte 6 : Byte count (N * 2)
 *    Byte 7.. : Register values (each 2 bytes)
 *
 * ============================================================
 */

function encodeDownlink(input) {

  // Extract required fields from the JSON input
  var slave = input.slaveAddress;
  var func  = input.functionCode;
  var reg   = input.register;
  var vals  = input.values;

  // Basic validation to avoid malformed downlinks
  if (slave === undefined || func === undefined || reg === undefined || !vals) {
    return { errors: ["Missing required fields: slaveAddress, functionCode, register, values"] };
  }

  // This array will contain the final Modbus frame
  var bytes = [];

  // ------------------------------------------------------------
  // 1. Write Modbus header (slave address + function code)
  // ------------------------------------------------------------
  bytes.push(slave & 0xFF);   // Slave address (1 byte)
  bytes.push(func & 0xFF);    // Function code (1 byte)

  // ------------------------------------------------------------
  // 2. Write register address (2 bytes, big-endian)
  // ------------------------------------------------------------
  bytes.push((reg >> 8) & 0xFF);  // High byte of register address
  bytes.push(reg & 0xFF);         // Low byte of register address

  // ------------------------------------------------------------
  // 3. Handle function code 0x06 (Write Single Register)
  // ------------------------------------------------------------
  if (func === 6) {

    // Only the first value is used for single-register writes
    var value = vals[0] || 0;

    // Write the register value (2 bytes, big-endian)
    bytes.push((value >> 8) & 0xFF);  // High byte
    bytes.push(value & 0xFF);         // Low byte

    // Return the final byte array
    return { bytes: bytes };
  }

  // ------------------------------------------------------------
  // 4. Handle function code 0x10 (Write Multiple Registers)
  // ------------------------------------------------------------
  if (func === 16) {

    var count = vals.length;  // Number of registers to write

    // Number of registers (2 bytes)
    bytes.push((count >> 8) & 0xFF);  // High byte
    bytes.push(count & 0xFF);         // Low byte

    // Byte count = number of registers * 2
    bytes.push(count * 2);

    // Write each register value (2 bytes per value)
    for (var i = 0; i < count; i++) {
      var v = vals[i];
      bytes.push((v >> 8) & 0xFF);  // High byte
      bytes.push(v & 0xFF);         // Low byte
    }

    return { bytes: bytes };
  }

  // ------------------------------------------------------------
  // 5. Unsupported function code
  // ------------------------------------------------------------
  return { errors: ["Unsupported function code. Use 6 (0x06) or 16 (0x10)."] };
}
