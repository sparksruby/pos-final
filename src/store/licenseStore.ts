import { create } from "zustand";
import {
  buildDeviceInfo, loadLicenseConfig, saveLicenseConfig, clearLicenseConfig,
  registerLicense, checkLicense, type LicensePayload,
} from "../utils/license";

export type LicenseGateStatus = "checking" | "valid" | "blocked";

interface LicenseStore {
  status:     LicenseGateStatus;
  // Set only when status is "blocked" — why (expired/inactive/invalid/no
  // internet on first activation/etc.), shown on the gate screen.
  message:    string;
  activating: boolean;

  // Runs once at app start — trusts a previously-saved activation if the
  // device is offline right now (this app is offline-first everywhere
  // else, licensing shouldn't be the one thing that stops working without
  // a connection), but requires a real server round-trip the first time.
  init:     () => Promise<void>;
  activate: (key: string, location: string) => Promise<boolean>;
}

export const useLicenseStore = create<LicenseStore>((set) => ({
  status:     "checking",
  message:    "",
  activating: false,

  init: async () => {
    const config = await loadLicenseConfig();
    if (!config) {
      set({ status: "blocked", message: "" });
      return;
    }

    const result = await checkLicense(config);
    if (result.ok) {
      // "valid" (server confirmed) or "offline" (no connection right now —
      // trust the config that was already validated once at activation).
      set({ status: "valid", message: "" });
    } else {
      // Server explicitly rejected it (expired/inactive/invalid) — clear
      // the stored key so the gate screen starts from a blank field
      // instead of silently retrying the same rejected key forever.
      await clearLicenseConfig();
      set({ status: "blocked", message: result.message });
    }
  },

  activate: async (key, location) => {
    set({ activating: true, message: "" });
    try {
      const device_info = await buildDeviceInfo();
      const payload: LicensePayload = { key: key.trim(), device_info, location: location.trim(), branch_id: "0" };
      const result = await registerLicense(payload);

      if (result.status === "offline") {
        set({ message: "OFFLINE" });
        return false;
      }
      if (!result.ok) {
        set({ message: result.message });
        return false;
      }

      await saveLicenseConfig(payload);
      set({ status: "valid", message: "" });
      return true;
    } finally {
      set({ activating: false });
    }
  },
}));
