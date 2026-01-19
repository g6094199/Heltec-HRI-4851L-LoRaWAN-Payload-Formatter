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
 *
 *  Supported Features:
 *  -------------------
 *  • Dynamic register mapping per Modbus slave address
 *  • Multiple datatypes:
 *        - uint16   (unsigned 16-bit)
 *        - int16    (signed 16-bit)
 *        - uint32   (unsigned 32-bit)
 *        - int32    (signed 32-bit)
 *        - float32  (IEEE754 floating point)
 *  • Endianness control:
 *        - "big"     → Standard Modbus big-endian
 *        - "little"  → Byte-swapped
 *        - "mixed"   → Word-swapped float32 (common in Modbus)
 *  • Per-register scaling factors
 *  • Bitmask decoding for status registers
 *  • Automatic fallback for unknown registers
 *
 *  Payload Structure (Modbus RTU-like):
 *  ------------------------------------
 *    Byte 0 : Modbus slave address
 *    Byte 1 : Modbus function code (usually 0x03)
 *    Byte 2 : Byte count (number of data bytes)
 *    Byte 3..N : Register data (2 bytes per register)
 *
 * ============================================================
 *
 *  IMPORTANT PLATFORM DIFFERENCES:
 *  -------------------------------
 *  • ChirpStack ALWAYS provides raw bytes → no Base64 decoding.
 *  • TTN SOMETIMES provides Base64 → fallback logic is included.
 *
 *  The TTN fallback logic is kept but can be disabled if needed.
 *
 * ============================================================
 */

function decodeUplink(input) {

  // ------------------------------------------------------------
  // 1. Extract raw bytes from the uplink
  // ------------------------------------------------------------
  // ChirpStack ALWAYS provides raw bytes in input.bytes.
  // TTN MAY provide raw bytes OR Base64.
  //
  // We start by reading input.bytes directly.
  // If they are missing or empty, we assume TTN Base64 mode.
  let bytes = input.bytes;

  /**
   * ============================================================
   *  TTN-SPECIFIC FALLBACK (ENABLED HERE, BUT CAN BE DISABLED)
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
   *  These blocks decode Base64 only if raw bytes are missing.
   *  This ensures compatibility with TTN while not affecting
   *  ChirpStack (which always provides raw bytes).
   *
   * ============================================================
   */

  // TTN V3 Base64 fallback (classic safe property access)
  if ((!bytes || bytes.length === 0) &&
      input.uplink_message &&
      input.uplink_message.frm_payload) {

    // Convert Base64 → byte array
    bytes = base64ToBytes(input.uplink_message.frm_payload);
  }

  // TTN V2 Base64 fallback
  if ((!bytes || bytes.length === 0) && input.payload_raw) {
    bytes = base64ToBytes(input.payload_raw);
  }

  // ------------------------------------------------------------
  // 1b. Final validation of byte availability
  // ------------------------------------------------------------
  // ChirpStack ALWAYS provides bytes → missing bytes = error.
  // TTN MAY send empty payloads → also error.
  if (!bytes || bytes.length === 0) {
    return {
      errors: [
        "No payload bytes found. ChirpStack always provides raw bytes. TTN may provide empty payloads."
      ]
    };
  }

  // ------------------------------------------------------------
  // 2. Parse Modbus header (common for TTN + ChirpStack)
  // ------------------------------------------------------------
  // These first three bytes define the structure of the Modbus
  // response frame. They are always present in valid payloads.
  //
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
  //
  // This mapping allows the decoder to interpret the raw bytes
  // correctly depending on which device responded.
  const deviceMap = {

    // ---------------- Device at Modbus Address 1 ----------------
    1: {
      // Register 0: signed temperature value, scaled by 1000
      0: { name: "temperature", type: "int16",  scale: 1000, endian: "big" },

      // Register 1: status register with bitmask decoding
      1: { name: "status", type: "uint16", scale: 1, endian: "big",
           bitmask: {
             0: "system_ok",
             1: "heater_on",
             2: "fan_on",
             3: "error_flag",
             4: "maintenance_required"
           }
      },

      // Register 2–3: 32-bit energy counter
      2: { name: "energy_total", type: "uint32", scale: 1, endian: "big" }
    },

    // ---------------- Device at Modbus Address 2 ----------------
    2: {
      0: { name: "co2",   type: "uint16", scale: 1, endian: "big" },
      1: { name: "voc",   type: "float32", scale: 1, endian: "mixed" },
      3: { name: "power", type: "int32", scale: 10, endian: "little" }
    }
  };

  // Select mapping for this slave address.
  // If no mapping exists, fallback decoding will be used.
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
  // Continue until all bytes defined by byteCount are consumed.
  // Each register consumes either 2 or 4 bytes depending on type.
  while (offset < 3 + byteCount) {

    // Lookup register definition for this index
    const map = registerMap[regIndex];

    // --------------------------------------------------------
    // Unknown register → fallback to raw uint16
    // --------------------------------------------------------
    // This ensures that no data is lost even if the mapping
    // does not define a specific register.
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
