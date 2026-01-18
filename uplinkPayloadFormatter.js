/**
 * ============================================================
 *  TTN / LoRaWAN Payload Decoder for Modbus Devices
 * ============================================================
 *
 *  This decoder is designed for industrial Modbus-over-LoRaWAN
 *  applications where multiple Modbus devices (slaves) may be
 *  queried through a single LoRaWAN node.
 *
 *  Features:
 *  ---------
 *  ✔ Dynamic register mapping based on Modbus slave address
 *  ✔ Per-register datatype support:
 *        - uint16   (unsigned 16-bit)
 *        - int16    (signed 16-bit)
 *        - uint32   (unsigned 32-bit)
 *        - int32    (signed 32-bit)
 *        - float32  (IEEE754 32-bit floating point)
 *
 *  ✔ Per-register endianness:
 *        - "big"     → Standard Modbus big-endian
 *        - "little"  → Byte-reversed
 *        - "mixed"   → Word-swapped float32 (common in Modbus)
 *
 *  ✔ Per-register scaling factors
 *
 *  ✔ Bitmask decoding for status registers
 *        Example:
 *        bitmask: { 0: "heater_on", 1: "fan_on", 3: "error" }
 *
 *  ✔ Automatic fallback for unknown registers
 *
 *  Payload Structure:
 *  ------------------
 *  Byte 0 : Modbus slave address
 *  Byte 1 : Modbus function code (typically 0x03)
 *  Byte 2 : Byte count (number of data bytes following)
 *  Byte 3..N : Register data (2 bytes per register)
 *
 *  This decoder is flexible, extensible, and suitable for
 *  industrial deployments with heterogeneous Modbus devices.
 *
 * ============================================================
 */

function decodeUplink(input) {

  // ------------------------------------------------------------
  // 1. Extract raw bytes (TTN V2 or V3)
  // ------------------------------------------------------------
  let bytes = input.bytes;

  // TTN V3: Base64 payload inside uplink_message.frm_payload
  if ((!bytes || bytes.length === 0) && input.uplink_message?.frm_payload) {
    bytes = base64ToBytes(input.uplink_message.frm_payload);
  }

  // TTN V2: Base64 payload inside payload_raw
  if ((!bytes || bytes.length === 0) && input.payload_raw) {
    bytes = base64ToBytes(input.payload_raw);
  }

  if (!bytes || bytes.length === 0) {
    return { errors: ["No payload bytes found."] };
  }

  // ------------------------------------------------------------
  // 2. Parse Modbus header
  // ------------------------------------------------------------
  const slaveAddress = bytes[0];   // Modbus slave ID
  const functionCode = bytes[1];   // Modbus function code (0x03 = Read Holding Registers)
  const byteCount    = bytes[2];   // Number of data bytes following

  // ------------------------------------------------------------
  // 3. Dynamic device mapping based on slave address
  //    Each device defines its own register structure.
  // ------------------------------------------------------------
  const deviceMap = {

    // Example Device at Modbus Address 1
    1: {
      0: { name: "temperature", type: "int16",  scale: 1000, endian: "big" },
      1: { name: "status",      type: "uint16", scale: 1,    endian: "big",
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

    // Example Device at Modbus Address 2
    2: {
      0: { name: "co2",   type: "uint16", scale: 1, endian: "big" },
      1: { name: "voc",   type: "float32", scale: 1, endian: "mixed" },
      3: { name: "power", type: "int32", scale: 10, endian: "little" }
    }
  };

  // Select mapping for this device
  const registerMap = deviceMap[slaveAddress] || {};

  // Output object
  const result = {};

  // Offset where register data begins
  let offset = 3;
  let regIndex = 0;

  // ------------------------------------------------------------
  // 4. Decode registers sequentially
  // ------------------------------------------------------------
  while (offset < 3 + byteCount) {

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

      // Bitmask decoding (if defined)
      if (map.bitmask) {
        const statusObj = {};
        for (const bit in map.bitmask) {
          const name = map.bitmask[bit];
          statusObj[name] = (rawValue & (1 << bit)) !== 0;
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

      // Endianness handling
      if (map.endian === "little") {
        [b0, b1, b2, b3] = [b3, b2, b1, b0];
      }

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

      if (map.endian === "little") {
        [b0, b1, b2, b3] = [b3, b2, b1, b0];
      }

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

      // Endianness handling
      if (map.endian === "little") {
        [b0, b1, b2, b3] = [b3, b2, b1, b0];
      }

      if (map.endian === "mixed") {
        // Word swap: 0 1 2 3 → 2 3 0 1
        [b0, b1, b2, b3] = [b2, b3, b0, b1];
      }

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

    regIndex++;
  }

  // ------------------------------------------------------------
  // 5. Return decoded data
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
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  return Array.from(binary, c => c.charCodeAt(0));
}
