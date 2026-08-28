import { getDb } from "./database";
import type { ShopSettings, UpdateShopSettingsRequest } from "../types";

interface ShopRow {
  id:             number;
  name:           string | null;
  address:        string | null;
  phone:          string | null;
  tax_percent:    number;
  currency:       string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  loyalty_enabled:     number;
  loyalty_earn_rate:   number;
  loyalty_redeem_rate: number;
  label_default_text:  string | null;
}

const toShopSettings = (r: ShopRow): ShopSettings => ({
  id:            r.id,
  name:          r.name ?? undefined,
  address:       r.address ?? undefined,
  phone:         r.phone ?? undefined,
  taxPercent:    r.tax_percent,
  currency:      r.currency ?? undefined,
  receiptHeader: r.receipt_header ?? undefined,
  receiptFooter: r.receipt_footer ?? undefined,
  loyaltyEnabled:    !!r.loyalty_enabled,
  loyaltyEarnRate:   r.loyalty_earn_rate,
  loyaltyRedeemRate: r.loyalty_redeem_rate,
  labelDefaultText:  r.label_default_text ?? undefined,
});

export const shopRepo = {
  get: async (): Promise<ShopSettings> => {
    const db = await getDb();
    const row = await db.getFirstAsync<ShopRow>("SELECT * FROM shop_settings WHERE id = 1");
    if (!row) throw new Error("SHOP_SETTINGS_NOT_FOUND");
    return toShopSettings(row);
  },

  update: async (body: UpdateShopSettingsRequest): Promise<ShopSettings> => {
    const db = await getDb();
    await db.runAsync(
      `UPDATE shop_settings
       SET name = ?, address = ?, phone = ?, tax_percent = ?, currency = ?, receipt_header = ?, receipt_footer = ?,
           loyalty_enabled = ?, loyalty_earn_rate = ?, loyalty_redeem_rate = ?, label_default_text = ?
       WHERE id = 1`,
      [body.name ?? null, body.address ?? null, body.phone ?? null, body.taxPercent,
       body.currency ?? null, body.receiptHeader ?? null, body.receiptFooter ?? null,
       body.loyaltyEnabled ? 1 : 0, body.loyaltyEarnRate, body.loyaltyRedeemRate, body.labelDefaultText ?? null]
    );
    const row = await db.getFirstAsync<ShopRow>("SELECT * FROM shop_settings WHERE id = 1");
    return toShopSettings(row!);
  },
};
