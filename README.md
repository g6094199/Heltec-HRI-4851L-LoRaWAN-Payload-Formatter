# Heltec-HRI-4851L-LoRaWAN-Payload-Formatter

A LoRaWAN ([The Things Network](https://www.thethingsnetwork.org/) and [Chirpstack](https://www.chirpstack.io/)) payload formatter for the [Heltec HRI 4851L](https://heltec.org/project/rs485-lorawan-wireless-converter) ModBus RTU to LoRaWAN converter.

The formater uses the incoming Base64 encoded LoRaWAN message and encodes it to 

Features:
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
