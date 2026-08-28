import { create } from "zustand";
import { productsRepo } from "../db/productsRepo";
import { useBranchStore } from "./branchStore";
import type { Category, Product } from "../types";

interface ProductStore {
  categories:         Category[];
  selectedCategoryId: number | null;
  isLoading:          boolean;
  error:              string | null;

  load:           () => Promise<void>;
  selectCategory: (id: number) => void;
  activeItems:    () => Product[];
}

// Reads the active branch from branchStore itself rather than requiring
// every caller to pass one — POS/Inventory/Products-manage all just want
// "reload for whichever branch is current" after any stock-changing action.
export const useProductStore = create<ProductStore>((set, get) => ({
  categories:         [],
  selectedCategoryId: null,
  isLoading:          false,
  error:              null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const branchId = useBranchStore.getState().currentBranchId;
      if (!branchId) { set({ categories: [], selectedCategoryId: null }); return; }
      const cats = await productsRepo.getCategories(branchId);
      set({ categories: cats, selectedCategoryId: cats[0]?.id ?? null });
    } catch (e: any) {
      set({ error: e?.message ?? "Could not load products" });
    } finally {
      set({ isLoading: false });
    }
  },

  selectCategory: (id) => set({ selectedCategoryId: id }),

  activeItems: () => {
    const { categories, selectedCategoryId } = get();
    return categories.find(c => c.id === selectedCategoryId)?.products ?? [];
  },
}));
