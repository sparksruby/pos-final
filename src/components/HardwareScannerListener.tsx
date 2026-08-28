import React, { useEffect, useRef, useState } from "react";
import { TextInput, StyleSheet } from "react-native";

interface Props {
  /** Only capture while true — e.g. disable while a camera or form is on screen. */
  enabled: boolean;
  onScan: (code: string) => void;
}

// Bluetooth/USB barcode scanners in "HID keyboard wedge" mode need no pairing
// protocol beyond normal OS Bluetooth pairing — they just type the barcode
// into whatever has keyboard focus, followed by Enter. This renders an
// invisible, auto-refocusing TextInput to catch that input without a visible
// on-screen keyboard ever popping up (showSoftInputOnFocus disables it, so a
// human can't type into this field by tapping — only a physical/HID device
// sending real key events reaches it).
export const HardwareScannerListener = ({ enabled, onScan }: Props) => {
  const inputRef = useRef<TextInput>(null);
  const [buffer, setBuffer] = useState("");

  useEffect(() => {
    if (!enabled) return;
    inputRef.current?.focus();
  }, [enabled]);

  const finish = (code: string) => {
    setBuffer("");
    const trimmed = code.trim();
    if (trimmed.length > 0) onScan(trimmed);
    // Re-claim focus for the next scan — but only right after a real scan
    // completes, not on a blind timer, so it never fights a visible input
    // (like a search box) that the user is actively typing into.
    inputRef.current?.focus();
  };

  if (!enabled) return null;

  return (
    <TextInput
      ref={inputRef}
      value={buffer}
      onChangeText={(text) => {
        // Some scanners append a newline character instead of firing a
        // separate submit event.
        if (text.includes("\n")) {
          finish(text.replace(/\n/g, ""));
        } else {
          setBuffer(text);
        }
      }}
      onSubmitEditing={(e) => finish(e.nativeEvent.text)}
      showSoftInputOnFocus={false}
      blurOnSubmit={false}
      autoCorrect={false}
      autoCapitalize="none"
      style={styles.hidden}
    />
  );
};

const styles = StyleSheet.create({
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, top: -100, left: -100 },
});
