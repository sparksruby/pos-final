import { create } from "zustand";
import type { CartItem, PriceMode, Product } from "../types";

interface CartStore {
  cart:            CartItem[];
  /** Which price tier new/existing lines are charged at — see Product.wholesalePrice. Resets to "retail" on clearCart. */
  priceMode:       PriceMode;
  addItem:         (product: Product) => void;
  removeItem:      (productId: number) => void;
  setQty:          (productId: number, qty: number) => void;
  setItemDiscount: (productId: number, discount: number) => void;
  /** Switches the whole cart's active price tier, repricing every existing line. */
  setPriceMode:    (mode: PriceMode) => void;
  clearCart:       () => void;

  total:     () => number;
  itemCount: () => number;
  getQty:    (productId: number) => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  cart: [],
  priceMode: "retail",

  addItem: (product) => {
    set(s => {
      const found = s.cart.find(c => c.productId === product.id);
      if (found) {
        return { cart: s.cart.map(c =>
          c.productId === product.id ? { ...c, qty: c.qty + 1 } : c
        )};
      }
      const retailPrice = product.price;
      const wholesalePrice = product.wholesalePrice;
      const price = s.priceMode === "wholesale" ? (wholesalePrice ?? retailPrice) : retailPrice;
      return {
        cart: [...s.cart, {
          productId: product.id,
          name:      product.name,
          unit:      product.unit,
          price,
          retailPrice,
          wholesalePrice,
          qty:       1,
        }],
      };
    });
  },

  setPriceMode: (mode) => {
    set(s => ({
      priceMode: mode,
      cart: s.cart.map(c => ({
        ...c,
        price: mode === "wholesale" ? (c.wholesalePrice ?? c.retailPrice) : c.retailPrice,
      })),
    }));
  },

  removeItem: (productId) =>
    set(s => ({ cart: s.cart.filter(c => c.productId !== productId) })),

  setQty: (productId, qty) => {
    if (qty <= 0) { get().removeItem(productId); return; }
    set(s => ({
      cart: s.cart.map(c =>
        c.productId === productId ? { ...c, qty } : c
      ),
    }));
  },

  setItemDiscount: (productId, discount) => {
    const amt = Math.max(0, discount || 0);
    set(s => ({
      cart: s.cart.map(c =>
        c.productId === productId ? { ...c, discount: amt } : c
      ),
    }));
  },

  clearCart: () => set({ cart: [], priceMode: "retail" }),

  total:     () => get().cart.reduce((s, c) => s + Math.max(0, c.price * c.qty - (c.discount ?? 0)), 0),
  itemCount: () => get().cart.reduce((s, c) => s + c.qty, 0),
  getQty:    (id) => get().cart.find(c => c.productId === id)?.qty ?? 0,
}));
