import { PermissionsAndroid, Platform } from "react-native";

// Android 12+ (API 31+) needs the new runtime Bluetooth permissions;
// everything before that needs location access to see nearby/bonded
// Bluetooth devices. iOS has no equivalent prompt for Classic Bluetooth.
export const requestBluetoothPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== "android") return true;

  try {
    if (Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);
      return Object.values(granted).every(
        (v) => v === PermissionsAndroid.RESULTS.GRANTED,
      );
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};
