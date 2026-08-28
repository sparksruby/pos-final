import * as FileSystem from "expo-file-system";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const DIR_URI_KEY = "pos_direct_save_dir_uri";

// SAF (Storage Access Framework) is Android-only — on iOS there's no
// equivalent "pick a folder, write straight into it" API; the share
// sheet's own "Save to Files" destination already covers that case, so
// callers should just hide the direct-save button on iOS.
export const isDirectSaveAvailable = Platform.OS === "android";

// Asks once, remembers the folder the user picked (e.g. Downloads) so
// every later export writes straight there without asking again — until
// that permission gets revoked (uninstall, OS storage reset, user changes
// their mind in Settings), in which case the create/write below throws and
// this re-prompts on the next attempt.
const getDirectoryUri = async (forceReprompt = false): Promise<string | null> => {
  if (!forceReprompt) {
    const saved = await AsyncStorage.getItem(DIR_URI_KEY);
    if (saved) return saved;
  }
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  await AsyncStorage.setItem(DIR_URI_KEY, permission.directoryUri);
  return permission.directoryUri;
};

/**
 * Copies `sourceUri` (a file already on disk, e.g. from cacheDirectory)
 * straight into a user-picked folder, no share sheet involved. Returns
 * true on success, false if the user declined the folder picker or this
 * isn't Android.
 */
export const saveToDevice = async (sourceUri: string, mimeType: string, fileName: string): Promise<boolean> => {
  if (!isDirectSaveAvailable) return false;

  const base64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });

  let dirUri = await getDirectoryUri();
  if (!dirUri) return false;

  try {
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(dirUri, fileName, mimeType);
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return true;
  } catch {
    // Saved folder permission likely stale — clear it and ask once more
    // before giving up, rather than failing forever on a bad cached uri.
    await AsyncStorage.removeItem(DIR_URI_KEY);
    dirUri = await getDirectoryUri(true);
    if (!dirUri) return false;
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(dirUri, fileName, mimeType);
    await FileSystem.writeAsStringAsync(destUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return true;
  }
};
