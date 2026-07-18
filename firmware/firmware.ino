#include <bluefruit.h>
#include <Wire.h>
#include <Adafruit_BNO08x.h>

// SitSync-Neck, SitSync-LowerBack, SitSync-LeftShoulder or SitSync-RightShoulder.
#ifndef SIT_SYNC_SENSOR_NAME
#define SIT_SYNC_SENSOR_NAME "SitSync-Neck"
#endif

constexpr char BLE_NAME[] = SIT_SYNC_SENSOR_NAME;
constexpr uint8_t BNO08X_ADDR = 0x4A;
constexpr uint32_t SENSOR_INTERVAL_US = 20000;  // Read orientation at 50 Hz.
constexpr uint32_t SEND_INTERVAL_MS = 100;      // Send orientation at 10 Hz.
constexpr size_t TELEMETRY_PACKET_SIZE = 20;
constexpr uint8_t TELEMETRY_MAGIC_0 = 'S';
constexpr uint8_t TELEMETRY_MAGIC_1 = 'S';
constexpr uint8_t TELEMETRY_VERSION = 1;

Adafruit_BNO08x bno08x(-1);
BLEUart bleuart;
sh2_SensorValue_t sensorValue;

float quatX = 0;
float quatY = 0;
float quatZ = 0;
float quatW = 1;
uint8_t quaternionAccuracy = 0;
uint32_t packetSequence = 0;
uint32_t lastSendTime = 0;
bool hasQuaternion = false;

void writeUint32LE(uint8_t* destination, uint32_t value) {
  destination[0] = static_cast<uint8_t>(value);
  destination[1] = static_cast<uint8_t>(value >> 8);
  destination[2] = static_cast<uint8_t>(value >> 16);
  destination[3] = static_cast<uint8_t>(value >> 24);
}

void writeQuaternionComponent(uint8_t* destination, float value) {
  const float clamped = constrain(value, -1.0f, 1.0f);
  const int16_t quantized = static_cast<int16_t>(roundf(clamped * 32767.0f));
  destination[0] = static_cast<uint8_t>(quantized);
  destination[1] = static_cast<uint8_t>(
    static_cast<uint16_t>(quantized) >> 8
  );
}

void enableOrientationReport() {
  while (!bno08x.enableReport(
    SH2_GAME_ROTATION_VECTOR,
    SENSOR_INTERVAL_US
  )) {
    delay(100);
  }
}

void startAdvertising() {
  Bluefruit.Advertising.addFlags(
    BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE
  );
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(bleuart);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.start(0);
}

void setup() {
  Wire.begin();
  while (!bno08x.begin_I2C(BNO08X_ADDR, &Wire, -1)) {
    delay(500);
  }
  enableOrientationReport();

  Bluefruit.begin(1, 0);
  Bluefruit.setTxPower(4);
  Bluefruit.setName(BLE_NAME);
  bleuart.begin();
  startAdvertising();
}

void loop() {
  if (bno08x.wasReset()) {
    enableOrientationReport();
  }

  if (
    bno08x.getSensorEvent(&sensorValue) &&
    sensorValue.sensorId == SH2_GAME_ROTATION_VECTOR
  ) {
    quatX = sensorValue.un.gameRotationVector.i;
    quatY = sensorValue.un.gameRotationVector.j;
    quatZ = sensorValue.un.gameRotationVector.k;
    quatW = sensorValue.un.gameRotationVector.real;
    quaternionAccuracy = sensorValue.status;
    hasQuaternion = true;
  }

  const uint32_t now = millis();
  if (
    !hasQuaternion ||
    !Bluefruit.connected() ||
    now - lastSendTime < SEND_INTERVAL_MS
  ) {
    return;
  }
  lastSendTime = now;

  uint8_t packet[TELEMETRY_PACKET_SIZE];
  packet[0] = TELEMETRY_MAGIC_0;
  packet[1] = TELEMETRY_MAGIC_1;
  packet[2] = TELEMETRY_VERSION;
  packet[3] = quaternionAccuracy;
  writeUint32LE(packet + 4, packetSequence++);
  writeUint32LE(packet + 8, now);
  writeQuaternionComponent(packet + 12, quatX);
  writeQuaternionComponent(packet + 14, quatY);
  writeQuaternionComponent(packet + 16, quatZ);
  writeQuaternionComponent(packet + 18, quatW);
  bleuart.write(packet, sizeof(packet));
}
