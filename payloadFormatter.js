/**
 * TTN Payload Decoder for Modbus data
 *
 * Features:
 *  - Supports Base64 decoding (TTN V2 & V3)
 *  - Handles one or multiple Modbus registers
 *  - Applies a scaling factor (example: temperature /1000)
 *
 * Expected Modbus RTU frame structure (without CRC):
 *  [0] Slave address
 *  [1] Function code (e.g., 0x03 = Read Holding Registers)
 *  [2] Byte count (number of data bytes that follow)
 *  [3..] Register data (2 bytes per register, big-endian)
 */

function decodeUplink(input) {

  // TTN normally provides a byte array directly
  let bytes = input.bytes;

  // TTN V3: Base64 payload is inside uplink_message.frm_payload
  if ((!bytes || bytes.length === 0) && input.uplink_message?.frm_payload) {
    bytes = base64ToBytes(input.uplink_message.frm_payload);
  }

  // TTN V2: Base64 payload is inside payload_raw
  if ((!bytes || bytes.length === 0) && input.payload_raw) {
    bytes = base64ToBytes(input.payload_raw);
  }

  // If still no bytes available → return error
  if (!bytes || bytes.length === 0) {
    return { errors: ["No payload bytes found (neither input.bytes nor Base64)."] };
  }

  // ----------------------------------------------------
  // Read Modbus header fields
  // ----------------------------------------------------

  const slaveAddress = bytes[0];   // Modbus slave ID
  const functionCode = bytes[1];   // Modbus function code
  const byteCount    = bytes[2];   // Number of data bytes that follow

  // Number of registers = byteCount / 2 (each register = 2 bytes)
  const registerCount = byteCount / 2;

  // Array to store decoded register values
  const registers = [];

  // ----------------------------------------------------
  // Decode register data
  // ----------------------------------------------------
  for (let i = 0; i < registerCount; i++) {

    // Register data position:
    // Register 0 → bytes[3] & bytes[4]
    // Register 1 → bytes[5] & bytes[6]
    // etc.
    const hi = bytes[3 + i * 2];   // High byte
    const lo = bytes[4 + i * 2];   // Low byte

    // Combine into 16‑bit big-endian integer
    const rawValue = (hi << 8) | lo;

    // Example scaling:
    // Many sensors report temperature in milli-degrees → divide by 1000
    const scaledValue = rawValue / 1000;

    // Store decoded register
    registers.push({
      index: i,          // Register index (0-based)
      rawValue,          // Raw Modbus register value
      scaledValue        // Scaled value (e.g., temperature)
    });
  }

  // ----------------------------------------------------
  // Return decoded data to TTN
  // ----------------------------------------------------
  return {
    data: {
      slaveAddress,
      functionCode,
      registerCount,
      registers
    }
  };
}

/**
 * Helper: Convert Base64 string → byte array
 * TTN sometimes provides payloads only in Base64.
 */
function base64ToBytes(b64) {
  const binary = atob(b64);                     // Base64 → binary string
  return Array.from(binary, c => c.charCodeAt(0)); // binary → byte array
}
