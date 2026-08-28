import { create } from "zustand";
import { syncRepo, SyncError, type SyncConfig } from "../db/syncRepo";
import { useBranchStore } from "./branchStore";

interface SyncResult { salesPushed: number; movementsPushed: number; skipped: number; pulled: number }

interface SyncStore {
  config:      SyncConfig | null;
  isReady:     boolean;
  isSyncing:   boolean;
  lastError:   string | null;
  lastResult:  SyncResult | null;

  load:         () => Promise<void>;
  connect:      (serverUrl: string, deviceApiKey: string) => Promise<void>;
  disconnect:   () => Promise<void>;
  syncNow:      () => Promise<void>;
  setAdminKey:  (adminKey: string) => Promise<void>;
}

// A device is either fully offline (config === null, same as before sync
// existed — nothing here applies) or connected to a sync backend and bound
// to one branch (config.boundBranchId) — see src/db/syncRepo.ts for what
// connecting/syncing actually does, and branchStore for how boundBranchId
// locks the branch switcher.
export const useSyncStore = create<SyncStore>((set, get) => ({
  config:     null,
  isReady:    false,
  isSyncing:  false,
  lastError:  null,
  lastResult: null,

  load: async () => {
    const config = await syncRepo.getConfig();
    set({ config, isReady: true });
  },

  connect: async (serverUrl, deviceApiKey) => {
    set({ isSyncing: true, lastError: null });
    try {
      const currentBranchId = useBranchStore.getState().currentBranchId;
      await syncRepo.connect(serverUrl, deviceApiKey, currentBranchId);
      const result = await syncRepo.syncNow();
      const config = await syncRepo.getConfig();
      set({ lastResult: result, config });
    } catch (e) {
      console.error("[sync] connect failed:", e);
      set({ lastError: e instanceof SyncError ? e.message : `CONNECT_FAILED: ${(e as any)?.message ?? String(e)}` });
      throw e;
    } finally {
      set({ isSyncing: false });
    }
  },

  disconnect: async () => {
    await syncRepo.disconnect();
    set({ config: null, lastResult: null, lastError: null });
  },

  syncNow: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true, lastError: null });
    try {
      const result = await syncRepo.syncNow();
      const config = await syncRepo.getConfig();
      set({ lastResult: result, config });
    } catch (e) {
      console.error("[sync] syncNow failed:", e);
      set({ lastError: e instanceof SyncError ? e.message : `SYNC_FAILED: ${(e as any)?.message ?? String(e)}` });
    } finally {
      set({ isSyncing: false });
    }
  },

  setAdminKey: async (adminKey) => {
    await syncRepo.setAdminKey(adminKey);
    const config = await syncRepo.getConfig();
    set({ config });
  },
}));
