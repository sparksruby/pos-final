import { create } from "zustand";
import { shopRepo } from "../db/shopRepo";
import type { ShopSettings } from "../types";

interface ShopStore {
  settings: ShopSettings | null;
  loaded:   boolean;

  load:        () => Promise<void>;
  setSettings: (s: ShopSettings) => void;
}

// Shared cache so the payment screen (tax %) and the receipt (name/address/
// header/footer) don't each query shop settings independently.
export const useShopStore = create<ShopStore>((set) => ({
  settings: null,
  loaded:   false,

  load: async () => {
    try {
      const settings = await shopRepo.get();
      set({ settings, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setSettings: (settings) => set({ settings }),
}));
