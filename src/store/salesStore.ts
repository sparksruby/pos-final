import { create } from "zustand";
import { salesRepo } from "../db/salesRepo";
import { useCartStore } from "./cartStore";
import type { SalePayment, SalePaymentMethod, Sale } from "../types";

interface CheckoutInput {
  discount:     number;
  taxPercent:   number;
  tendered:     number;
  method:       SalePaymentMethod;
  payments?:    SalePayment[];
  cashierId?:   number;
  cashierName?: string;
  customerId?:     number;
  pointsRedeemed?: number;
  shiftId?:        number;
  branchId:        number;
}

interface SalesStore {
  isSubmitting: boolean;
  checkout: (input: CheckoutInput) => Promise<Sale>;
}

export const useSalesStore = create<SalesStore>((set) => ({
  isSubmitting: false,

  checkout: async (input) => {
    set({ isSubmitting: true });
    try {
      const { cart, clearCart } = useCartStore.getState();
      const sale = await salesRepo.checkout({ items: cart, ...input });
      clearCart();
      return sale;
    } finally {
      set({ isSubmitting: false });
    }
  },
}));
