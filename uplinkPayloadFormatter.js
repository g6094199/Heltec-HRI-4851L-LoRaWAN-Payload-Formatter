/**
 * ============================================================
 *  TTN / ChirpStack LoRaWAN Payload Decoder for Modbus Devices
 * ============================================================
 *
 *  This decoder processes Modbus-over-LoRaWAN uplink frames.
 *  It supports multiple Modbus devices, each with its own
 *  register layout, datatypes, scaling, and endianness rules.
 *
 *  The goal is to provide a flexible, industrial-grade decoder
 *  that can handle heterogeneous Modbus devices connected to
 *  a single LoRaWAN node.

  *  It supports:
 *    - Dynamic register mapping per slave address
 *    - Multiple datatypes (uint16, int16, uint32, int32, float32)
 *    - Endianness control (big, little, mixed)
 *    - Scaling factors
 *    - Bitmask decoding
 *    - Fallback decoding for unknown registers
 *
 *  Payload Structure:
 *    Byte 0 : Modbus slave address
 *    Byte 1 : Modbus function code (usually 0x03)
 *    Byte 2 : Byte count (number of data bytes)
 *    Byte 3..N : Register data (2 bytes per register)
 *
 * ============================================================
 *
 *  IMPORTANT:
 *  ----------
 *  ChirpStack ALWAYS provides raw bytes → no Base64 decoding.
 *  TTN SOMETIMES provides Base64 → fallback logic exists but is
 *  commented out to avoid interfering with ChirpStack.
 *
 * ============================================================
 */

function decodeUplink(input) {

  // ------------------------------------------------------------
  // 1. Extract raw bytes
  // ------------------------------------------------------------
  // ChirpStack ALWAYS provides raw bytes in input.bytes.
  // TTN MAY provide raw bytes OR Base64.
  let bytes = input.bytes;

  /**
   * ============================================================
   *  TTN-SPECIFIC FALLBACK (DISABLED FOR CHIRPSTACK)
   * ============================================================
   *
   *  TTN V3:
   *    - Sometimes provides Base64 in input.uplink_message.frm_payload
   *    - ChirpStack NEVER uses this field.
   *
   *  TTN V2:
   *    - Sometimes provides Base64 in input.payload_raw
   *    - ChirpStack NEVER uses this field.
   *
   *  These blocks are commented out to avoid breaking ChirpStack.
   *  If you want to use this decoder on TTN again, simply
   *  uncomment teh nex 2 TTN specific blocks.
   * ============================================================
   */

  /*
  // TTN V3 Base64 fallback (your requested modification applied)
  if ((!bytes || bytes.length === 0) && input.uplink_message && input.uplink_message.frm_payload) {
    bytes = base64ToBytes(input.uplink_message.frm_payload);
  }

  // TTN V2 Base64 fallback
  if ((!bytes || bytes.length === 0) && input.payload_raw) {
    bytes = base64ToBytes(input.payload_raw);
  }
  */

  //* ===================== End TTN specific ============================

  // ChirpStack: If bytes are missing → this is a real error. On TTN this is an empty payload
  if (!bytes || bytes.length === 0) {
    return { errors: ["No payload bytes found. ChirpStack always provides raw bytes. TTN has no payload"] };
  }

  // ------------------------------------------------------------
  // 2. Parse Modbus header (common for TTN + ChirpStack)
  // ------------------------------------------------------------
  // Byte 0 = Modbus slave address (0–247)
  // Byte 1 = Modbus function code (0x03 = Read Holding Registers)
  // Byte 2 = Byte count (number of data bytes following)
  const slaveAddress = bytes[0];
  const functionCode = bytes[1];
  const byteCount    = bytes[2];

  // ------------------------------------------------------------
  // 3. Device-specific register mapping
  // ------------------------------------------------------------
  // Each Modbus slave device may expose different registers,
  // datatypes, scaling rules, and endianness.
  const deviceMap = {

    // ---------------- Device at Modbus Address 1 ----------------
    1: {
      0: { name: "temperature", type: "int16",  scale: 1000, endian: "big" },

      1: { name: "status", type: "uint16", scale: 1, endian: "big",
           bitmask: {
             0: "system_ok",
             1: "heater_on",
             2: "fan_on",
             3: "error_flag",
             4: "maintenance_required"
           }
      },

      2: { name: "energy_total", type: "uint32", scale: 1, endian: "big" }
    },

    // ---------------- Device at Modbus Address 2 ----------------
    2: {
      0: { name: "co2",   type: "uint16", scale: 1, endian: "big" },
      1: { name: "voc",   type: "float32", scale: 1, endian: "mixed" },
      3: { name: "power", type: "int32", scale: 10, endian: "little" }
    }
  };

  // Select mapping for this slave address
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

      let hi = bytes[offset];
      let lo = bytes[offset + 1];

      // Endianness handling
      if (map.endian === "little") [hi, lo] = [lo, hi];

      rawValue = (hi << 8) | lo;

      // Bitmask decoding
      if (map.bitmask) {
        const statusObj = {};
        for (const bit in map.bitmask) {
          statusObj[map.bitmask[bit]] = (rawValue & (1 << bit)) !== 0;
        }
        result[map.name] = statusObj;
      } else {
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

      if (map.endian === "little") [hi, lo] = [lo, hi];

      rawValue = (hi << 8) | lo;

      // Convert to signed
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

      if (map.endian === "little") [b0, b1, b2, b3] = [b3, b2, b1, b0];

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

      if (map.endian === "little") [b0, b1, b2, b3] = [b3, b2, b1, b0];

      rawValue = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;

      // Convert to signed 32-bit
      if (rawValue & 0x80000000) rawValue -= 0x100000000;

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

      if (map.endian === "little") [b0, b1, b2, b3] = [b3, b2, b1, b0];
      if (map.endian === "mixed")  [b0, b1, b2, b3] = [b2, b3, b0, b1];

      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);

      view.setUint8(0, b0);
      view.setUint8(1, b1);
      view.setUint8(2, b2);
      view.setUint8(3, b3);

      result[map.name] = view.getFloat32(0, false) / map.scale;

      offset += 4;
    }

    regIndex++;
  }

  // ------------------------------------------------------------
  // 5. Return decoded data (same for TTN + ChirpStack)
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
 * Base64 → bytes
 * Only needed for TTN, NOT for ChirpStack.
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  return Array.from(binary, c => c.charCodeAt(0));
}
