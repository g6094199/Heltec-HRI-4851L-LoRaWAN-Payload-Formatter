# Heltec-HRI-4851L-LoRaWAN-Payload-Formatter

A LoRaWAN ([The Things Network](https://www.thethingsnetwork.org/) and [Chirpstack](https://www.chirpstack.io/)) payload formatter for the [Heltec HRI 4851L](https://heltec.org/project/rs485-lorawan-wireless-converter) ModBus RTU to LoRaWAN converter.

The formater uses the incoming Base64 encoded LoRaWAN message and encodes it to 





# Device Mapping example


------------------------------------------------------------
PAYLOAD STRUCTURE
------------------------------------------------------------
 *
 *  Byte 0 : Modbus slave address
 *  Byte 1 : Function code (typically 0x03)
 *  Byte 2 : Byte count (number of data bytes following)
 *  Byte 3..N : Register data (2 bytes per register)
 *
 *  Example:
 *    01 03 08 4C 08 00 16 00 01 86 A0
 *
------------------------------------------------------------
MAPPING CONFIGURATION
------------------------------------------------------------

  All register mappings are defined inside:

      const deviceMap = { ... };

  Each top-level key represents a Modbus slave address.

  Example:
      1: { ... }   // Device at address 1
      2: { ... }   // Device at address 2

------------------------------------------------------------
  REGISTER DEFINITION FORMAT
------------------------------------------------------------

  Each register entry follows this structure:

      registerIndex: {
        name:   "field_name",
        type:   "datatype",
        scale:  number,
        endian: "big" | "little" | "mixed",
        bitmask: { ... }   // optional
      }
 *
 *  Meaning of fields:
 *
 *    registerIndex : Register number starting from 0
 *    name          : Output field name shown in TTN
 *    type          : Datatype used to decode the register
 *    scale         : Raw value is divided by this number
 *    endian        : Byte order used by the device
 *    bitmask       : Optional mapping of bits to named flags
 *
 * ------------------------------------------------------------
 *  SUPPORTED DATATYPES
 * ------------------------------------------------------------
 *
 *    uint16  → 2 bytes, unsigned
 *    int16   → 2 bytes, signed
 *    uint32  → 4 bytes, unsigned (2 registers)
 *    int32   → 4 bytes, signed (2 registers)
 *    float32 → 4 bytes, IEEE754 (2 registers)
 *
 * ------------------------------------------------------------
 *  ENDIANNESS OPTIONS
 * ------------------------------------------------------------
 *
 *    "big"    → Standard Modbus (MSB first)
 *    "little" → Full byte reversal
 *    "mixed"  → Word-swapped float32 (common in Modbus)
 *
 * ------------------------------------------------------------
 *  SCALING
 * ------------------------------------------------------------
 *
 *  The decoder divides the raw value by the scale.
 *
 *  Examples:
 *    Raw: 19464, scale 1000 → 19.464
 *    Raw: 450,   scale 10   → 45.0
 *    Raw: 812,   scale 1    → 812
 *
 * ------------------------------------------------------------
 *  BITMASK DECODING
 * ------------------------------------------------------------
 *
 *  Some registers contain multiple status bits.
 *  Example:
 *
 *      bitmask: {
 *        0: "system_ok",
 *        1: "heater_on",
 *        2: "fan_on",
 *        3: "error_flag"
 *      }
 *
 *  If raw value = 0b00000110, output becomes:
 *
 *      system_ok  = false
 *      heater_on  = true
 *      fan_on     = true
 *      error_flag = false
 *
 * ------------------------------------------------------------
 *  EXAMPLE MAPPING
 * ------------------------------------------------------------
 *
 *  Device at address 1:
 *
 *      1: {
 *        0: { name: "temperature", type: "int16", scale: 1000, endian: "big" },
 *        1: { name: "status",      type: "uint16", scale: 1, endian: "big",
 *             bitmask: {
 *               0: "system_ok",
 *               1: "heater_on",
 *               2: "fan_on",
 *               3: "error_flag"
 *             }
 *        },
 *        2: { name: "energy_total", type: "uint32", scale: 1, endian: "big" }
 *      }
 *
 * ------------------------------------------------------------
 *  ADDING A NEW DEVICE
 * ------------------------------------------------------------
 *
 *  If the device uses address 7 and has:
 *    - Register 0: float32, big endian
 *    - Register 2: int32, little endian, scale 100
 *
 *  Add:
 *
 *      7: {
 *        0: { name: "pressure", type: "float32", scale: 1, endian: "big" },
 *        2: { name: "power",    type: "int32",   scale: 100, endian: "little" }
 *      }
 *
 * ------------------------------------------------------------
 *  TESTING IN TTN CONSOLE
 * ------------------------------------------------------------
 *
 *  Use Base64 payloads in the TTN decoder test window.
 *
 *  Example:
 *    Raw bytes: 01 03 02 FF 9C
 *    Base64:    AQMC/5w=
 *
 *  Expected output:
 *    temperature = -0.1
 *
 * ------------------------------------------------------------
 *  END OF DOCUMENTATION
 * ============================================================
 */

 
