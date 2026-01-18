/**
 * ============================================================
 *  TTN / LoRaWAN Payload Decoder for Modbus Devices
 * ============================================================
 *
 *  This decoder processes Modbus-over-LoRaWAN uplink frames.
 *  It supports multiple Modbus devices, each with its own
 *  register layout, datatypes, scaling, and endianness rules.
 *
 *  The goal is to provide a flexible, industrial-grade decoder
 *  that can handle heterogeneous Modbus devices connected to
 *  a single LoRaWAN node.
 *
 *  The decoder supports:
 *    - uint16, int16, uint32, int32, float32
 *    - big-endian, little-endian, mixed-endian (word swap)
 *    - per-register scaling
 *    - bitmask decoding for status registers
 *    - fallback decoding for unknown registers
 *
 *  Payload Structure:
 *    Byte 0 : Modbus slave address
 *    Byte 1 : Modbus function code (usually 0x03)
 *    Byte 2 : Byte count (number of data bytes)
 *    Byte 3..N : Register data (2 bytes per register)
 *
 * ============================================================
 */

function decodeUplink(input) {

  // ------------------------------------------------------------
  // 1. Extract raw bytes (TTN V2 or V3)
  // ------------------------------------------------------------
  // TTN V3 provides decoded bytes in input.bytes OR base64 in uplink_message.frm_payload
  let bytes = input.bytes;

  // If bytes are missing, try TTN V3 base64 field
  if ((!bytes || bytes.length === 0) && input.uplink_message?.frm_payload) {
    bytes = base64ToBytes(input.uplink_message.frm_payload);
  }

  // If still missing, try TTN V2 base64 field
  if ((!bytes || bytes.length === 0) && input.payload_raw) {
    bytes = base64ToBytes(input.payload_raw);
  }

  // If no bytes found at all, return an error
  if (!bytes || bytes.length === 0) {
    return { errors: ["No payload bytes found."] };
  }

  // ------------------------------------------------------------
  // 2. Parse Modbus header
  // ------------------------------------------------------------
  // These three bytes define the Modbus frame structure
  const slaveAddress = bytes[0];   // Modbus slave ID (0–247)
  const functionCode = bytes[1];   // Function code (0x03 = Read Holding Registers)
  const byteCount    = bytes[2];   // Number of data bytes following

  // ------------------------------------------------------------
  // 3. Dynamic device mapping based on slave address
  // ------------------------------------------------------------
  // Each Modbus device type has its own register layout.
  // The decoder selects the correct mapping based on slaveAddress.
  const deviceMap = {

    // --------------------------------------------------------
    // Device at Modbus Address 1
    // --------------------------------------------------------
    1: {
      // Register 0: signed 16-bit temperature, scaled by 1000
      0: { name: "temperature", type: "int16",  scale: 1000, endian: "big" },

      // Register 1: uint16 status register with bitmask decoding
      1: { name: "status",      type: "uint16", scale: 1,    endian: "big",
           bitmask: {
             0: "system_ok",
             1: "heater_on",
             2: "fan_on",
             3: "error_flag",
             4: "maintenance_required"
           }
      },

      // Register 2–3: uint32 energy counter
      2: { name: "energy_total", type: "uint32", scale: 1, endian: "big" }
    },

    // --------------------------------------------------------
    // Device at Modbus Address 2
    // --------------------------------------------------------
    2: {
      // Register 0: CO₂ concentration (uint16)
      0: { name: "co2",   type: "uint16", scale: 1, endian: "big" },

      // Register 1–2: VOC sensor value (float32, word-swapped)
      1: { name: "voc",   type: "float32", scale: 1, endian: "mixed" },

      // Register 3–4: signed 32-bit power value, scaled by 10
      3: { name: "power", type: "int32", scale: 10, endian: "little" }
    }
  };

  // Select mapping for this specific device
  const registerMap = deviceMap[slaveAddress] || {};

  // Output object for decoded values
  const result = {};

  // Offset where register data begins (after header)
  let offset = 3;

  // Logical register index (0,1,2,...)
  let regIndex = 0;

  // ------------------------------------------------------------
  // 4. Decode registers sequentially
  // ------------------------------------------------------------
  // Continue until all bytes defined by byteCount are consumed
  while (offset < 3 + byteCount) {

    // Lookup register definition for this index
    const map = registerMap[regIndex];

    // --------------------------------------------------------
    // Unknown register → fallback to raw uint16
    // --------------------------------------------------------
    if (!map) {
      // Read 16-bit unsigned value
      const raw = (bytes[offset] << 8) | bytes[offset + 1];
      result[`register_${regIndex}`] = raw;

      offset += 2;
      regIndex++;
      continue;
    }

    let rawValue;

    // --------------------------------------------------------
    // uint16 (unsigned 16-bit)
    // --------------------------------------------------------
    if (map.type === "uint16") {

      // Extract high and low bytes
      let hi = bytes[offset];
      let lo = bytes[offset + 1];

      // Swap bytes if little-endian
      if (map.endian === "little") [hi, lo] = [lo, hi];

      // Combine into 16-bit unsigned integer
      rawValue = (hi << 8) | lo;

      // If bitmask exists, decode individual bits
      if (map.bitmask) {
        const statusObj = {};
        for (const bit in map.bitmask) {
          const name = map.bitmask[bit];
          statusObj[name] = (rawValue & (1 << bit)) !== 0;
        }
        result[map.name] = statusObj;
      } else {
        // Apply scaling
        result[map.name] = rawValue / map.scale;
      }

      offset += 2;
    }

    // --------------------------------------------------------
    // int16 (signed 16-bit)
    // --------------------------------------------------------
    else if (map.type === "int16") {

      let hi = bytes[offset];
      let lo = bytes[offset + 1];

      // Swap if little-endian
      if (map.endian === "little") [hi, lo] = [lo, hi];

      // Combine bytes
      rawValue = (hi << 8) | lo;

      // Convert to signed 16-bit
      if (rawValue & 0x8000) rawValue -= 0x10000;

      result[map.name] = rawValue / map.scale;

      offset += 2;
    }

    // --------------------------------------------------------
    // uint32 (unsigned 32-bit)
    // --------------------------------------------------------
    else if (map.type === "uint32") {

      let b0 = bytes[offset];
      let b1 = bytes[offset + 1];
      let b2 = bytes[offset + 2];
      let b3 = bytes[offset + 3];

      // Reverse byte order if little-endian
      if (map.endian === "little") {
        [b0, b1, b2, b3] = [b3, b2, b1, b0];
      }

      // Combine into 32-bit unsigned integer
      rawValue = (b0 * 16777216) + (b1 << 16) + (b2 << 8) + b3;

      result[map.name] = rawValue / map.scale;

      offset += 4;
    }

    // --------------------------------------------------------
    // int32 (signed 32-bit)
    // --------------------------------------------------------
    else if (map.type === "int32") {

      let b0 = bytes[offset];
      let b1 = bytes[offset + 1];
      let b2 = bytes[offset + 2];
      let b3 = bytes[offset + 3];

      // Reverse byte order if little-endian
      if (map.endian === "little") {
        [b0, b1, b2, b3] = [b3, b2, b1, b0];
      }

      // Combine into 32-bit signed integer
      rawValue = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;

      // Convert to signed 32-bit
      if (rawValue & 0x80000000) {
        rawValue -= 0x100000000;
      }

      result[map.name] = rawValue / map.scale;

      offset += 4;
    }

    // --------------------------------------------------------
    // float32 (IEEE754)
    // --------------------------------------------------------
    else if (map.type === "float32") {

      let b0 = bytes[offset];
      let b1 = bytes[offset + 1];
      let b2 = bytes[offset + 2];
      let b3 = bytes[offset + 3];

      // Little-endian → reverse all bytes
      if (map.endian === "little") {
        [b0, b1, b2, b3] = [b3, b2, b1, b0];
      }

      // Mixed-endian → word swap (common in Modbus)
      if (map.endian === "mixed") {
        [b0, b1, b2, b3] = [b2, b3, b0, b1];
      }

      // Use DataView to decode IEEE754 float
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);

      view.setUint8(0, b0);
      view.setUint8(1, b1);
      view.setUint8(2, b2);
      view.setUint8(3, b3);

      const floatVal = view.getFloat32(0, false); // big-endian inside buffer
      result[map.name] = floatVal / map.scale;

      offset += 4;
    }

    // Move to next logical register index
    regIndex++;
  }

  // ------------------------------------------------------------
  // 5. Return decoded data in TTN format
  // ------------------------------------------------------------
  return {
    data: {
      slaveAddress,
      functionCode,
      values: result
    }
  };
}

/**
 * Convert Base64 string → byte array
 * Used for TTN V2 and V3 compatibility.
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  return Array.from(binary, c => c.charCodeAt(0));
}
