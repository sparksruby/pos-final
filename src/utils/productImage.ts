import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";

const IMAGE_DIR = `${FileSystem.documentDirectory}products/`;

const ensureDir = async () => {
  const info = await FileSystem.getInfoAsync(IMAGE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
};

// Picks a photo from the library and copies it into the app's own document
// directory — the picker's returned URI can point at a cache location the OS
// may reclaim, so persisting our own copy is what keeps the image around.
export const pickProductImage = async (): Promise<string | null> => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("PERMISSION_DENIED");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (result.canceled || !result.assets[0]) return null;

  await ensureDir();
  const ext = result.assets[0].uri.split(".").pop()?.split("?")[0] || "jpg";
  const dest = `${IMAGE_DIR}${Date.now()}.${ext}`;
  await FileSystem.copyAsync({ from: result.assets[0].uri, to: dest });
  return dest;
};

export const deleteProductImage = async (uri?: string) => {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
};
