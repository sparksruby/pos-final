import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { branchesRepo } from "../db/branchesRepo";
import { syncRepo } from "../db/syncRepo";
import type { Branch } from "../types";

const CURRENT_BRANCH_KEY = "pos_current_branch_id";

interface BranchStore {
  branches:        Branch[];
  currentBranchId: number | null;
  isReady:         boolean;
  /** True once this device is connected to a sync backend (src/store/syncStore.ts)
   * — its branch is then fixed to whichever one the server bound it to, and
   * setCurrentBranch()/the switcher UI stop applying (see e.g. the branch
   * pill in app/(pos)/index.tsx, gated on `!isLocked`). */
  isLocked:        boolean;

  load:               () => Promise<void>;
  setCurrentBranch:   (id: number) => Promise<void>;
  currentBranch:      () => Branch | null;
}

// Which branch's stock/sales this device is currently acting as. Normally a
// per-device preference persisted like the printer selection — but once
// sync is connected, the server is the source of truth for that instead
// (one device = one branch, permanently, chosen at connect time — see
// syncRepo.connect), and the AsyncStorage preference is ignored.
export const useBranchStore = create<BranchStore>((set, get) => ({
  branches:        [],
  currentBranchId: null,
  isReady:         false,
  isLocked:        false,

  load: async () => {
    const [branches, saved, syncConfig] = await Promise.all([
      branchesRepo.getAll(true),
      AsyncStorage.getItem(CURRENT_BRANCH_KEY),
      syncRepo.getConfig(),
    ]);

    if (syncConfig && branches.some(b => b.id === syncConfig.boundBranchId)) {
      set({ branches, currentBranchId: syncConfig.boundBranchId, isLocked: true, isReady: true });
      return;
    }

    const savedId = saved ? Number(saved) : null;
    const stillValid = savedId !== null && branches.some(b => b.id === savedId);
    const currentBranchId = stillValid ? savedId : (branches[0]?.id ?? null);
    set({ branches, currentBranchId, isLocked: false, isReady: true });
  },

  setCurrentBranch: async (id) => {
    if (get().isLocked) return;
    await AsyncStorage.setItem(CURRENT_BRANCH_KEY, String(id));
    set({ currentBranchId: id });
  },

  currentBranch: () => {
    const { branches, currentBranchId } = get();
    return branches.find(b => b.id === currentBranchId) ?? null;
  },
}));
