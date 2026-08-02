import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import {
  BLE_UART_SERVICE_UUID,
  BLE_UART_TX_CHAR_UUID,
} from '../config';
import { BodyPosition, ImuSample } from '../types';
import {
  parseBinaryImuTelemetry,
  parseImuTelemetry,
} from './parseImuTelemetry';

function decodeBase64(value: string): Uint8Array {
  const decode = (
    globalThis as typeof globalThis & { atob: (data: string) => string }
  ).atob;
  const decoded = decode(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

export type BleScanDevice = {
  id: string;
  name: string;
  rssi: number | null;
};

export type BleConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export class BleGateway {
  private manager = new BleManager();
  private connections = new Map<BodyPosition, Device>();
  private notificationSubscriptions = new Map<BodyPosition, Subscription>();
  private disconnectionSubscriptions = new Map<BodyPosition, Subscription>();
  private chunkBuffers = new Map<BodyPosition, string>();

  startScan(
    onDevice: (device: BleScanDevice) => void,
    onError: (message: string) => void,
  ): void {
    this.manager.startDeviceScan(
      [BLE_UART_SERVICE_UUID],
      null,
      (error, device) => {
        if (error) {
          onError(error.message);
          return;
        }
        if (!device?.name) return;
        onDevice({
          id: device.id,
          name: device.name,
          rssi: device.rssi,
        });
      },
    );
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  async connect(
    position: BodyPosition,
    scanDevice: BleScanDevice,
    onSample: (sample: ImuSample) => void,
    onStatus: (
      position: BodyPosition,
      status: BleConnectionStatus,
      detail: string,
    ) => void,
    onRawChunk?: (position: BodyPosition, chunk: string) => void,
  ): Promise<void> {
    this.stopScan();
    await this.disconnect(position);

    for (const [otherPosition, device] of this.connections) {
      if (device.id === scanDevice.id && otherPosition !== position) {
        await this.disconnect(otherPosition);
      }
    }

    onStatus(position, 'connecting', `Connecting to ${scanDevice.name}…`);
    try {
      const device = await this.manager.connectToDevice(scanDevice.id, {
        autoConnect: false,
      });
      await device.discoverAllServicesAndCharacteristics();
      this.connections.set(position, device);
      this.chunkBuffers.set(position, '');

      const disconnectSubscription = device.onDisconnected((_error) => {
        this.clearPosition(position);
        onStatus(position, 'disconnected', `${scanDevice.name} disconnected`);
      });
      this.disconnectionSubscriptions.set(position, disconnectSubscription);

      const notificationSubscription =
        device.monitorCharacteristicForService(
          BLE_UART_SERVICE_UUID,
          BLE_UART_TX_CHAR_UUID,
          (error, characteristic) => {
            if (error) {
              onStatus(position, 'error', error.message);
              return;
            }
            if (!characteristic?.value) return;

            const bytes = decodeBase64(characteristic.value);
            const binarySample = parseBinaryImuTelemetry(
              bytes,
              scanDevice.id,
              scanDevice.name,
              position,
            );
            if (binarySample) {
              console.info(
                `[SitSync BLE] ${position} parsed binary seq=${binarySample.sequence} accuracy=${binarySample.accuracy}`,
              );
              onRawChunk?.(position, binarySample.raw);
              onSample(binarySample);
              return;
            }

            // Compatibility path for boards that still run the previous
            // newline-delimited JSON firmware.
            const chunk = decodeAscii(bytes);
            console.info(
              `[SitSync BLE] ${position} RX ${chunk.length} bytes: ${JSON.stringify(chunk)}`,
            );
            onRawChunk?.(position, chunk);
            const buffered = (this.chunkBuffers.get(position) ?? '') + chunk;
            const lines = buffered.split(/\r?\n/);
            this.chunkBuffers.set(position, lines.pop() ?? '');

            for (const line of lines) {
              console.info(
                `[SitSync BLE] ${position} packet: ${JSON.stringify(line)}`,
              );
              const sample = parseImuTelemetry(
                line,
                scanDevice.id,
                scanDevice.name,
                position,
              );
              if (sample) {
                console.info(
                  `[SitSync BLE] ${position} parsed seq=${sample.sequence} accuracy=${sample.accuracy}`,
                );
                onSample(sample);
              } else if (line.trim()) {
                console.warn(
                  `[SitSync BLE] ${position} invalid packet: ${JSON.stringify(line)}`,
                );
                onStatus(position, 'error', `Invalid packet: ${line.trim()}`);
              }
            }
          },
        );
      this.notificationSubscriptions.set(position, notificationSubscription);
      onStatus(position, 'connected', `Receiving ${scanDevice.name}`);
    } catch (error) {
      this.clearPosition(position);
      const detail =
        error instanceof Error ? error.message : 'BLE connection failed';
      onStatus(position, 'error', detail);
      throw error;
    }
  }

  async disconnect(position: BodyPosition): Promise<void> {
    const device = this.connections.get(position);
    this.clearPosition(position);
    if (!device) return;
    try {
      await this.manager.cancelDeviceConnection(device.id);
    } catch {
      // Device may already be disconnected.
    }
  }

  async disconnectAll(): Promise<void> {
    const positions = [...this.connections.keys()];
    await Promise.all(positions.map((position) => this.disconnect(position)));
  }

  connectedDevice(position: BodyPosition): BleScanDevice | null {
    const device = this.connections.get(position);
    if (!device) return null;
    return {
      id: device.id,
      name: device.name ?? device.id,
      rssi: device.rssi,
    };
  }

  async destroy(): Promise<void> {
    await this.disconnectAll();
    this.manager.destroy();
  }

  private clearPosition(position: BodyPosition): void {
    this.notificationSubscriptions.get(position)?.remove();
    this.disconnectionSubscriptions.get(position)?.remove();
    this.notificationSubscriptions.delete(position);
    this.disconnectionSubscriptions.delete(position);
    this.connections.delete(position);
    this.chunkBuffers.delete(position);
  }
}

