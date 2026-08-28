import { BleManager, ConnectionPriority, Device, Characteristic } from "react-native-ble-plx";
import { requestBluetoothPermissions } from "./bluetoothPermissions";
import { encodeBase64 } from "./labelCommands";

// Most cheap/OEM thermal & label printers (the kind sold as "Bluetooth
// receipt printer" on marketplaces, including the Zywell ZY310 class of
// device) use a BLE UART-bridge chipset rather than exposing the Serial
// Port Profile (SPP) that react-native-bluetooth-escpos-printer requires —
// that library opens a classic RFCOMM socket
// (android/.../BluetoothService.java: createRfcommSocketToServiceRecord),
// which simply has nothing to connect to on a BLE-only device. This module
// is a second, independent transport for exactly that case: it talks BLE
// GATT instead, and every print path that wants to support BLE-only
// printers builds its own raw command bytes (see escposRaster.ts and
// tsplRaw.ts) and sends them through here rather than through the
// classic-only native module's high-level printPic/printLabel calls, which
// have no equivalent "give me the raw bytes so I can send them myself" —
// they own their own classic BluetoothSocket internally.
//
// UUIDs below match the "ISSC/HM-10-style" UART bridge profile that the
// overwhelming majority of these generic/white-label BLE thermal printers
// use (same chipset family gets reused across many marketplace-branded
// printers) — tried first since it's correct most of the time, with a
// fallback that just picks the first writable characteristic the device
// actually advertises, for the rest.
const KNOWN_WRITE_UUIDS = [
  "49535343-8841-43f4-a8d4-ecbe34729bb3", // ISSC UART TX (write)
  "0000ffe1-0000-1000-8000-00805f9b34fb", // HM-10-style single read/write characteristic
];

let manager: BleManager | null = null;
const getManager = (): BleManager => {
  if (!manager) manager = new BleManager();
  return manager;
};

export interface BleDeviceInfo {
  id:   string; // BLE MAC/UUID — distinct address space from Classic Bluetooth's, even for the same physical printer
  name: string;
}

// Scans for `timeoutMs`, then stops and resolves with whatever advertising
// devices with a name were seen. BLE devices only show up here while
// actively advertising — a printer already bonded but powered off, or one
// that stopped advertising after a prior connection, won't appear; power-
// cycling the printer before scanning is the usual fix (same as any BLE
// peripheral picker).
export const scanForBlePrinters = async (timeoutMs = 6000): Promise<BleDeviceInfo[]> => {
  const ok = await requestBluetoothPermissions();
  if (!ok) throw new Error("PERMISSION_DENIED");

  const seen = new Map<string, BleDeviceInfo>();
  const mgr = getManager();

  // Classic Bluetooth pairing (react-native-bluetooth-escpos-printer's
  // BluetoothManager.enableBluetooth) prompts to turn Bluetooth on itself
  // if it's off; ble-plx has no equivalent baked into scanning, so without
  // this, a device that has Bluetooth off just hangs here forever waiting
  // for a PoweredOn state that never arrives, with no feedback at all —
  // enable() is Android-only (rejects on iOS, where the OS never allows
  // this programmatically) so failures here are expected and swallowed;
  // the state-check below is what actually surfaces "still off" to the caller.
  if ((await mgr.state()) !== "PoweredOn") {
    await mgr.enable().catch(() => {});
  }
  if ((await mgr.state()) !== "PoweredOn") {
    throw new Error("BLUETOOTH_OFF");
  }

  return new Promise((resolve, reject) => {
    const sub = mgr.onStateChange(state => {
      if (state !== "PoweredOn") return;
      sub.remove();

      mgr.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (error) {
          mgr.stopDeviceScan();
          reject(error);
          return;
        }
        if (device?.name) seen.set(device.id, { id: device.id, name: device.name });
      });

      setTimeout(() => {
        mgr.stopDeviceScan();
        resolve(Array.from(seen.values()));
      }, timeoutMs);
    }, true);
  });
};

const findWritableCharacteristic = async (device: Device): Promise<{ serviceUUID: string; characteristic: Characteristic }> => {
  const services = await device.services();
  const writable: { serviceUUID: string; characteristic: Characteristic }[] = [];

  for (const service of services) {
    const chars = await service.characteristics();
    for (const c of chars) {
      if (c.isWritableWithResponse || c.isWritableWithoutResponse) {
        writable.push({ serviceUUID: service.uuid, characteristic: c });
      }
    }
  }

  if (writable.length === 0) throw new Error("NO_WRITABLE_CHARACTERISTIC");

  const known = writable.find(w => KNOWN_WRITE_UUIDS.includes(w.characteristic.uuid.toLowerCase()));
  return known ?? writable[0];
};

// Finds a notifiable characteristic in the same service as the write
// characteristic (the RX side of the UART bridge, sibling to the TX/write
// characteristic found above) so we can subscribe to it. Most of these
// cheap UART-bridge chipsets only start actually forwarding written bytes
// to their internal UART/print engine once a central has subscribed for
// notifications on the service — the write call itself still resolves
// successfully either way (the ATT-layer ack), so this is invisible as an
// error and shows up only as "connects fine, writes fine, nothing prints".
const findNotifyCharacteristic = async (
  device: Device,
  serviceUUID: string,
): Promise<Characteristic | null> => {
  const services = await device.services();
  const service = services.find(s => s.uuid === serviceUUID);
  if (!service) return null;

  const chars = await service.characteristics();
  return chars.find(c => c.isNotifiable) ?? null;
};

export interface BleLinkInfo {
  /** Negotiated ATT MTU. 23 means the peripheral refused to negotiate. */
  mtu:       number;
  /** Payload per GATT write — MTU minus 3 bytes of ATT overhead. */
  chunkSize: number;
  /** True when each write waits for the peripheral to acknowledge it. */
  withResponse: boolean;
  /** Whether Android granted the low-latency connection interval. */
  highPriority: boolean;
}

export interface BleWriter {
  write: (bytes: Uint8Array) => Promise<void>;
  disconnect: () => Promise<void>;
  info: BleLinkInfo;
}

// A print job's bytes routinely run into the tens of KB (a receipt image)
// — BLE's negotiated MTU caps a single GATT write far below that (typically
// 20 bytes with no negotiation, up to ~247 with it), so every write here is
// chunked, with a small pause between chunks. The pause isn't cosmetic:
// writing faster than the printer's own internal buffer drains it silently
// drops bytes on most of these chipsets (no flow-control signal is exposed
// at this GATT layer), which is exactly the "connected fine, nothing on
// paper" failure this transport exists to avoid reproducing.
// Pacing for writes WITHOUT a response, which have no acknowledgement to
// throttle them: outrunning the printer's own buffer makes these chipsets
// drop bytes silently, which is the "connected fine, nothing on paper"
// failure this transport exists to avoid.
//
// Paced per BATCH rather than per write, though. A receipt goes out in a
// few hundred writes, and pausing after every one of them spent a third of
// the whole print asleep — measured on real hardware: 55 KB in 15.5s, of
// which about 6s was this sleep. A pause every few writes leaves under a
// kilobyte in flight between breaths, which is well inside the buffer on
// anything that can print a receipt at all.
//
// A write WITH a response needs none of this: the peripheral's own
// acknowledgement is the flow control.
const CHUNK_DELAY_MS = 15;
const CHUNKS_PER_PAUSE = 4;

// Largest first. Android caps a GATT MTU at 517; most stacks grant 247 and
// some grant more. Each step up is proportionally fewer round trips for the
// same receipt, and a refusal costs one failed call.
const MTU_LADDER = [517, 247, 185];

export const connectBlePrinter = async (deviceId: string): Promise<BleWriter> => {
  const ok = await requestBluetoothPermissions();
  if (!ok) throw new Error("PERMISSION_DENIED");

  const mgr = getManager();
  let device = await mgr.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 });
  device = await device.discoverAllServicesAndCharacteristics();

  // Ask for the largest MTU this peripheral will grant, stepping down until
  // one is accepted. Falling all the way through is not itself a failure —
  // the default ~23-byte MTU still prints, just in many more chunks.
  for (const size of MTU_LADDER) {
    try {
      device = await device.requestMTU(size);
      break;
    } catch {
      // try the next size down
    }
  }
  const mtu = device.mtu ?? 23;
  const chunkSize = Math.max(20, mtu - 3); // 3 bytes of ATT write overhead

  // Ask Android for the low-latency connection interval.
  //
  // This is the other half of how long a print takes, and the half that is
  // invisible from the code: a receipt is sent as hundreds of writes, and
  // on the default "balanced" interval the radio only carries one every
  // 30-50ms no matter how small it is. High priority drops that to about
  // 11ms, so the same receipt goes out in a fraction of the time without a
  // single extra byte moving. Refusal is harmless — iOS has no equivalent
  // call and simply throws here.
  let highPriority = false;
  try {
    device = await device.requestConnectionPriority(ConnectionPriority.High);
    highPriority = true;
  } catch {
    // stay on whatever interval the OS picked
  }

  const { serviceUUID, characteristic } = await findWritableCharacteristic(device);
  const writeWithResponse = !characteristic.isWritableWithoutResponse;

  // Subscribing (monitorCharacteristicForService writes the CCCD 0x2902
  // descriptor under the hood) before writing anything — see
  // findNotifyCharacteristic's comment for why this is required on most of
  // these chipsets, not just a nice-to-have.
  let notifySubscription: { remove: () => void } | null = null;
  const notifyChar = characteristic.isNotifiable
    ? characteristic
    : await findNotifyCharacteristic(device, serviceUUID);
  if (notifyChar) {
    notifySubscription = device.monitorCharacteristicForService(
      serviceUUID,
      notifyChar.uuid,
      () => {}, // printers don't send anything meaningful back here; subscribing is what matters
    );
    // Give the peripheral a moment to process the CCCD write before we
    // start streaming print data at it.
    await sleep(150);
  }

  const write = async (bytes: Uint8Array): Promise<void> => {
    let sincePause = 0;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      const base64Chunk = encodeBase64(chunk);
      if (writeWithResponse) {
        await device.writeCharacteristicWithResponseForService(serviceUUID, characteristic.uuid, base64Chunk);
      } else {
        await device.writeCharacteristicWithoutResponseForService(serviceUUID, characteristic.uuid, base64Chunk);
      }

      if (writeWithResponse) continue;
      sincePause++;
      if (sincePause >= CHUNKS_PER_PAUSE && offset + chunkSize < bytes.length) {
        sincePause = 0;
        await sleep(CHUNK_DELAY_MS);
      }
    }
  };

  const disconnect = async (): Promise<void> => {
    notifySubscription?.remove();
    await mgr.cancelDeviceConnection(deviceId).catch(() => {});
  };

  return { write, disconnect, info: { mtu, chunkSize, withResponse: writeWithResponse, highPriority } };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
