import React, { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { F, R, ThemeColors } from "../theme";

interface Props {
  visible:   boolean;
  onScanned: (data: string) => void;
  onClose:   () => void;
}

// Full-screen camera scanner. Fires onScanned once per open (guarded by
// `scanned`) — the caller closes the modal itself once it's handled the
// result, since a failed lookup may want to let the user try again.
export const BarcodeScannerModal = ({ visible, onScanned, onClose }: Props) => {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) setScanned(false);
  }, [visible]);

  const handleScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScanned(data);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        {!permission ? (
          <View style={s.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : !permission.granted ? (
          <View style={s.center}>
            <Ionicons name="camera-outline" size={40} color="#94A3B8" />
            <Text style={s.permText}>{t("scanner.permissionText")}</Text>
            <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
              <Text style={s.permBtnText}>{t("scanner.grantPermission")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"],
              }}
              onBarcodeScanned={scanned ? undefined : handleScan}
            />
            <View style={s.frameOverlay} pointerEvents="none">
              <View style={s.frame} />
              <Text style={s.hint}>{t("scanner.hint")}</Text>
            </View>
          </>
        )}

        <TouchableOpacity style={[s.closeBtn, { backgroundColor: C.card }]} onPress={onClose}>
          <Ionicons name="close" size={24} color={C.text} />
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );
};

const makeStyles = (C: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },

  permText: { color: "#E2E8F0", fontSize: F.md, textAlign: "center" },
  permBtn: { backgroundColor: C.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: R.md },
  permBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },

  frameOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 16 },
  frame: { width: 260, height: 160, borderRadius: R.lg, borderWidth: 3, borderColor: "#fff" },
  hint: { color: "#fff", fontSize: F.sm, fontWeight: "600" },

  closeBtn: {
    position: "absolute", top: 16, right: 16, width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
});
