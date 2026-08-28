import React, { useEffect, useState } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, SafeAreaView, ScrollView, Modal,
  ActivityIndicator, StatusBar, Platform
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCartStore } from "../../src/store/cartStore";
import { useSalesStore } from "../../src/store/salesStore";
import { useProductStore } from "../../src/store/productStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { usePrint } from "@/context/PrintContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { usePrinterStore } from "../../src/store/printerStore";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { InsufficientStockError, InsufficientPointsError, ExpiredProductError } from "../../src/db/salesRepo";
import { customersRepo } from "../../src/db/customersRepo";
import { shiftsRepo } from "../../src/db/shiftsRepo";
import { useBranchStore } from "../../src/store/branchStore";
import { exportReceiptPdf } from "../../src/utils/receiptPdf";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { CartItem, Customer, PaymentMethod, Sale, SalePaymentMethod } from "../../src/types";

const QUICK = [10, 20, 50, 100, 200, 500];
const SPLIT_METHODS: PaymentMethod[] = ["Cash", "Card", "QR"];
type DiscountType = "fixed" | "percent";

const METHOD_ICONS: Record<SalePaymentMethod, keyof typeof Ionicons.glyphMap> = {
  Cash:  "cash-outline",
  Card:  "card-outline",
  QR:    "qr-code-outline",
  Split: "layers-outline",
};

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function PaymentScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);

  const METHODS: { key: SalePaymentMethod; label: string }[] = [
    { key: "Cash",  label: t("payment.cash")  },
    { key: "Card",  label: t("payment.card")  },
    { key: "QR",    label: t("payment.qr")    },
    { key: "Split", label: t("payment.split") },
  ];

  const { cart, setItemDiscount } = useCartStore();
  const { checkout, isSubmitting } = useSalesStore();
  const loadProducts = useProductStore(state => state.load);
  const { user } = useAuthStore();
  const currentBranchId = useBranchStore(state => state.currentBranchId);

  const grossSubtotal    = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const itemDiscountsTot = cart.reduce((sum, c) => sum + Math.max(0, c.discount ?? 0), 0);
  const afterItemDiscounts = Math.max(0, grossSubtotal - itemDiscountsTot);

  const [method,       setMethod]       = useState<SalePaymentMethod>("Cash");
  const [discountType, setDiscountType] = useState<DiscountType>("fixed");
  const [discount,     setDiscount]     = useState("0");
  const [tendered,     setTendered]     = useState(String(Math.ceil(afterItemDiscounts)));
  const [splitAmounts, setSplitAmounts] = useState<Record<PaymentMethod, string>>({ Cash: "0", Card: "0", QR: "0" });
  const [discountItem, setDiscountItem] = useState<CartItem | null>(null);
  const [discountItemValue, setDiscountItemValue] = useState("0");
  const [customer,          setCustomer]          = useState<Customer | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerSearch,    setCustomerSearch]    = useState("");
  const [customerResults,   setCustomerResults]   = useState<Customer[]>([]);
  const [redeemPoints,      setRedeemPoints]      = useState("0");
  const [openShiftId,       setOpenShiftId]       = useState<number | undefined>(undefined);
  // checkout() clears the cart immediately on success, which would otherwise
  // flip this screen to the "empty cart" branch below while the "what next"
  // alert is still up. Tracking the finished sale keeps the main UI behind
  // that alert until we navigate away.
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const { printReceipt } = usePrint();
  const initPrinter = usePrinterStore(state => state.init);
  const { settings: shopSettings, load: loadShopSettings } = useShopStore();

  useEffect(() => {
    initPrinter();
    loadShopSettings();
    shiftsRepo.getOpenShift().then(shift => setOpenShiftId(shift?.id));
  }, []);

  useEffect(() => {
    if (!customerModalOpen) return;
    customersRepo.search(customerSearch.trim()).then(setCustomerResults);
  }, [customerModalOpen, customerSearch]);

  if (cart.length === 0 && !completedSale) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{t("payment.emptyCart")}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={() => router.replace("/(pos)/")}>
          <Text style={s.retryText}>{t("common.back")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currency    = shopSettings?.currency ?? "$";
  const taxPercent  = shopSettings?.taxPercent ?? 0;
  const loyaltyEnabled = shopSettings?.loyaltyEnabled ?? false;
  const loyaltyEarnRate   = shopSettings?.loyaltyEarnRate ?? 0;
  const loyaltyRedeemRate = shopSettings?.loyaltyRedeemRate ?? 0;

  const discountNum = Math.max(0, Number(discount) || 0);
  const discountAmt = discountType === "percent"
    ? afterItemDiscounts * discountNum / 100
    : discountNum;
  const subtotal    = grossSubtotal;

  const maxRedeemable = customer?.loyaltyPoints ?? 0;
  const redeemPointsNum = loyaltyEnabled && customer
    ? Math.max(0, Math.min(Math.floor(Number(redeemPoints) || 0), maxRedeemable))
    : 0;
  const redeemValue = redeemPointsNum * loyaltyRedeemRate;

  const afterDiscount = Math.max(0, afterItemDiscounts - discountAmt - redeemValue);
  const taxAmt      = Math.round(afterDiscount * taxPercent / 100 * 100) / 100;
  const payable     = afterDiscount + taxAmt;
  const tenderedAmt = Number(tendered) || 0;
  const change      = Math.max(0, tenderedAmt - payable);
  const pointsToEarn = loyaltyEnabled && customer ? Math.floor(payable * loyaltyEarnRate) : 0;

  const splitTotal     = SPLIT_METHODS.reduce((sum, m) => sum + (Number(splitAmounts[m]) || 0), 0);
  const splitRemaining = Math.round((payable - splitTotal) * 100) / 100;

  const canPay =
    method === "Cash"  ? tenderedAmt >= payable :
    method === "Split" ? Math.abs(splitRemaining) < 0.01 && splitTotal > 0 :
    true;

  const openItemDiscount = (item: CartItem) => {
    setDiscountItem(item);
    setDiscountItemValue(item.discount ? String(item.discount) : "0");
  };

  const confirmItemDiscount = () => {
    if (discountItem) {
      setItemDiscount(discountItem.productId, Number(discountItemValue) || 0);
    }
    setDiscountItem(null);
  };

  const selectCustomer = (c: Customer) => {
    setCustomer(c);
    setRedeemPoints("0");
    setCustomerModalOpen(false);
    setCustomerSearch("");
  };

  const clearCustomer = () => {
    setCustomer(null);
    setRedeemPoints("0");
  };

  const quickCreateCustomer = async (name: string) => {
    try {
      const c = await customersRepo.create(name);
      selectCustomer(c);
    } catch {
      alert(t("common.error"), t("customers.duplicatePhone"));
    }
  };

  const handleSavePdf = async (sale: Sale) => {
    try {
      await exportReceiptPdf(sale, shopSettings);
    } catch {
      alert(t("common.error"), t("payment.pdfFailed"));
    }
  };

  const handlePay = async () => {
    if (!canPay) {
      alert(t("payment.insufficientTitle"), t("payment.insufficientMsg", { amount: `${currency}${payable.toLocaleString()}` }));
      return;
    }
    if (!currentBranchId) {
      alert(t("common.error"), t("branches.noBranch"));
      return;
    }
    try {
      const payments = method === "Split"
        ? SPLIT_METHODS
            .map(m => ({ method: m, amount: Number(splitAmounts[m]) || 0 }))
            .filter(p => p.amount > 0)
        : undefined;

      const sale = await checkout({
        discount:   discountAmt,
        taxPercent,
        tendered:   method === "Cash" ? tenderedAmt : payable,
        method,
        payments,
        cashierId:   user?.id,
        cashierName: user?.name,
        customerId:     customer?.id,
        pointsRedeemed: redeemPointsNum,
        shiftId:        openShiftId,
        branchId:       currentBranchId,
      });
      setCompletedSale(sale);
      loadProducts();
      alert(
        t("payment.completeTitle"),
        method === "Cash"
          ? t("payment.changeDue", { amount: `${currency}${change.toLocaleString()}` })
          : t("payment.received"),
        // Printing is what almost every sale ends with, so it leads and
        // Skip closes the list. Stacked buttons read top-down, and the one
        // most likely to be wanted should not be the one furthest from the
        // thumb.
        [
          {
            text: t("payment.printReceipt"),
            // Deliberately not awaited. The printer lives above the
            // navigator (see PrintContext), so the sale can close and the
            // paper can come out at the same time — the cashier is free to
            // start ringing up the next customer while it prints, instead
            // of watching a finished checkout screen until the receipt
            // finishes, or forever if the printer never answers.
            onPress: () => {
              printReceipt(sale);
              router.replace("/(pos)/");
            },
          },
          {
            text: t("payment.savePdf"),
            // Awaited, unlike printing: this one hands the file to the
            // system share sheet, and that has to be raised from a live
            // screen. It reports its own failures, and the screen closes
            // either way.
            onPress: async () => {
              try {
                await handleSavePdf(sale);
              } finally {
                router.replace("/(pos)/");
              }
            },
          },
          { text: t("payment.skip"), style: "cancel", onPress: () => router.replace("/(pos)/") },
        ]
      );
    } catch (e: any) {
      if (e instanceof InsufficientStockError) {
        alert(t("common.error"), t("payment.insufficientStock", { name: e.productName, available: e.available }));
      } else if (e instanceof ExpiredProductError) {
        alert(t("common.error"), t("payment.expiredProduct", { name: e.productName }));
      } else if (e instanceof InsufficientPointsError) {
        alert(t("common.error"), t("payment.insufficientPoints", { available: e.available }));
      } else {
        alert(t("common.error"), e.message ?? t("payment.failed"));
      }
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scrollOuter}>
        <View style={[s.scroll, isTablet && s.scrollTablet]}>

          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color={C.textSub} />
            </TouchableOpacity>
            <Text style={s.title}>{t("payment.title")}</Text>
          </View>

          {/* Cart items */}
          <View style={s.card}>
            <Text style={s.section}>{t("payment.items")}</Text>
            {cart.map(item => {
              const lineGross = item.price * item.qty;
              const lineDiscount = item.discount ?? 0;
              const lineNet = Math.max(0, lineGross - lineDiscount);
              return (
                <View key={item.productId} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowLabel}>
                      {item.name}
                      <Text style={s.rowQty}> × {item.qty} {item.unit}</Text>
                    </Text>
                    {lineDiscount > 0 && (
                      <Text style={s.rowDiscountNote}>
                        {t("payment.itemDiscountApplied", { amount: `${currency}${lineDiscount.toLocaleString()}` })}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity style={s.rowDiscountBtn} onPress={() => openItemDiscount(item)}>
                    <Ionicons name="pricetag-outline" size={15} color={C.accent} />
                  </TouchableOpacity>
                  <View style={s.rowAmtCol}>
                    {lineDiscount > 0 && (
                      <Text style={s.rowAmtStrike}>{currency}{lineGross.toLocaleString()}</Text>
                    )}
                    <Text style={s.rowAmt}>{currency}{lineNet.toLocaleString()}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Customer */}
          <View style={s.card}>
            <Text style={s.section}>{t("payment.customer")}</Text>
            {customer ? (
              <View>
                <View style={s.customerSelectedRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.customerSelectedName}>{customer.name}</Text>
                    {loyaltyEnabled && (
                      <Text style={s.customerSelectedPoints}>
                        {t("payment.pointsBalance", { points: customer.loyaltyPoints })}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={clearCustomer}>
                    <Ionicons name="close-circle" size={20} color={C.muted} />
                  </TouchableOpacity>
                </View>
                {loyaltyEnabled && customer.loyaltyPoints > 0 && (
                  <View style={{ marginTop: 10 }}>
                    <Text style={s.redeemLabel}>{t("payment.redeemPoints", { max: customer.loyaltyPoints })}</Text>
                    <TextInput
                      style={s.input}
                      keyboardType="numeric"
                      value={redeemPoints}
                      onChangeText={setRedeemPoints}
                      placeholder="0"
                      placeholderTextColor={C.muted}
                      selectTextOnFocus
                    />
                    {redeemPointsNum > 0 && (
                      <Text style={s.redeemHint}>
                        {t("payment.redeemValue", { amount: `${currency}${redeemValue.toLocaleString()}` })}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ) : (
              <TouchableOpacity style={s.selectCustomerBtn} onPress={() => setCustomerModalOpen(true)}>
                <Ionicons name="person-add-outline" size={16} color={C.accent} />
                <Text style={s.selectCustomerText}>{t("payment.selectCustomer")}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Discount */}
          <View style={s.card}>
            <Text style={s.section}>{t("payment.discount", { currency })}</Text>
            <View style={s.discountTypeRow}>
              <TouchableOpacity
                style={[s.discountTypeBtn, discountType === "fixed" && s.discountTypeActive]}
                onPress={() => setDiscountType("fixed")}
              >
                <Text style={[s.discountTypeText, discountType === "fixed" && s.discountTypeActiveText]}>{currency}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.discountTypeBtn, discountType === "percent" && s.discountTypeActive]}
                onPress={() => setDiscountType("percent")}
              >
                <Text style={[s.discountTypeText, discountType === "percent" && s.discountTypeActiveText]}>%</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={discount}
              onChangeText={setDiscount}
              placeholder="0"
              placeholderTextColor={C.muted}
              selectTextOnFocus
            />
          </View>

          {/* Payment method */}
          <View style={s.card}>
            <Text style={s.section}>{t("payment.method")}</Text>
            <View style={s.methodRow}>
              {METHODS.map(m => (
                <TouchableOpacity
                  key={m.key}
                  style={[s.methodBtn, method === m.key && s.methodActive]}
                  onPress={() => setMethod(m.key)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={METHOD_ICONS[m.key]}
                    size={20}
                    color={method === m.key ? C.accentFg : C.muted}
                  />
                  <Text style={[s.methodText, method === m.key && s.methodActiveText]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Cash tendered */}
          {method === "Cash" && (
            <View style={s.card}>
              <Text style={s.section}>{t("payment.tendered", { currency })}</Text>
              <TextInput
                style={s.input}
                keyboardType="numeric"
                value={tendered}
                onChangeText={setTendered}
                placeholderTextColor={C.muted}
                selectTextOnFocus
              />
              <View style={s.quickRow}>
                {QUICK.map(amt => (
                  <TouchableOpacity
                    key={amt}
                    style={[s.quickBtn, tenderedAmt === amt && s.quickActive]}
                    onPress={() => setTendered(String(amt))}
                  >
                    <Text style={[s.quickText, tenderedAmt === amt && s.quickActiveText]}>
                      {currency}{amt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Split payment breakdown */}
          {method === "Split" && (
            <View style={s.card}>
              <Text style={s.section}>{t("payment.splitBreakdown")}</Text>
              {SPLIT_METHODS.map(m => (
                <View key={m} style={s.splitRow}>
                  <Text style={s.splitLabel}>{t(`payment.${m.toLowerCase()}` as any)}</Text>
                  <TextInput
                    style={s.splitInput}
                    keyboardType="numeric"
                    value={splitAmounts[m]}
                    onChangeText={(v) => setSplitAmounts(prev => ({ ...prev, [m]: v }))}
                    placeholder="0"
                    placeholderTextColor={C.muted}
                    selectTextOnFocus
                  />
                </View>
              ))}
              <Text style={[
                s.splitRemain,
                Math.abs(splitRemaining) < 0.01 ? s.splitRemainOk : s.splitRemainBad,
              ]}>
                {splitRemaining > 0.004
                  ? t("payment.splitRemaining", { amount: `${currency}${splitRemaining.toLocaleString()}` })
                  : splitRemaining < -0.004
                  ? t("payment.splitOver", { amount: `${currency}${Math.abs(splitRemaining).toLocaleString()}` })
                  : t("payment.splitComplete")}
              </Text>
            </View>
          )}

          {/* Summary */}
          <View style={[s.card, { gap: 8 }]}>
            <SumRow s={s} C={C} label={t("payment.subtotal")} value={`${currency}${subtotal.toLocaleString()}`} />
            {itemDiscountsTot + discountAmt > 0 &&
              <SumRow s={s} C={C} label={t("payment.discountLabel")} value={`- ${currency}${(itemDiscountsTot + discountAmt).toLocaleString()}`} dim />
            }
            {redeemValue > 0 &&
              <SumRow s={s} C={C} label={t("payment.pointsRedeemedLabel", { points: redeemPointsNum })} value={`- ${currency}${redeemValue.toLocaleString()}`} dim />
            }
            {taxAmt > 0 &&
              <SumRow s={s} C={C} label={t("payment.tax", { percent: taxPercent })} value={`${currency}${taxAmt.toLocaleString()}`} dim />
            }
            <View style={s.divider} />
            <SumRow s={s} C={C} label={t("payment.payable")} value={`${currency}${payable.toLocaleString()}`} accent large />
            {method === "Cash" && tenderedAmt > 0 &&
              <SumRow s={s} C={C} label={t("payment.change")} value={`${currency}${change.toLocaleString()}`} green />
            }
            {pointsToEarn > 0 &&
              <SumRow s={s} C={C} label={t("payment.pointsToEarn")} value={`+${pointsToEarn}`} green />
            }
          </View>

        </View>
      </ScrollView>

      {/* The amount due and the button that takes it sit in a bar pinned to
          the bottom of the screen, outside the ScrollView. They used to be
          the last things in the scroll: on a phone a cashier had to scroll
          past the items, the customer, the discount, the method and the
          cash tendered before either the total or the Pay button came into
          view — on the one screen where the total is the whole point. */}
      <View style={s.payBar}>
        <View style={s.payBarAmtCol}>
          <Text style={s.payBarLabel} numberOfLines={1}>{t("payment.payable")}</Text>
          <Text style={s.payBarAmt} numberOfLines={1} adjustsFontSizeToFit>
            {currency}{payable.toLocaleString()}
          </Text>
        </View>
        <TouchableOpacity
          style={[s.payBtn, !canPay && s.payOff]}
          onPress={handlePay}
          disabled={!canPay || isSubmitting}
          activeOpacity={0.85}
        >
          {isSubmitting
            ? <ActivityIndicator color={C.accentFg} />
            : (
              <>
                <Ionicons name="checkmark-circle" size={21} color={C.accentFg} />
                <Text style={s.payText}>{t("payment.payNow")}</Text>
              </>
            )
          }
        </TouchableOpacity>
      </View>

      {/* Per-item discount */}
      <Modal visible={!!discountItem} transparent animationType="fade" onRequestClose={() => setDiscountItem(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>
              {t("payment.itemDiscountTitle", { name: discountItem?.name ?? "" })}
            </Text>
            <TextInput
              style={s.input}
              keyboardType="numeric"
              value={discountItemValue}
              onChangeText={setDiscountItemValue}
              placeholder="0"
              placeholderTextColor={C.muted}
              autoFocus
              selectTextOnFocus
            />
            <View style={s.modalBtnRow}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setDiscountItem(null)}>
                <Text style={s.modalCancelText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalConfirmBtn} onPress={confirmItemDiscount}>
                <Text style={s.modalConfirmText}>{t("common.confirm")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Customer picker */}
      <Modal visible={customerModalOpen} animationType="slide" transparent onRequestClose={() => setCustomerModalOpen(false)}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.modalTitle}>{t("payment.selectCustomer")}</Text>
            <TextInput
              style={s.input}
              value={customerSearch}
              onChangeText={setCustomerSearch}
              placeholder={t("customers.searchPlaceholder")}
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <ScrollView style={s.customerResultsList}>
              {customerResults.map(c => (
                <TouchableOpacity key={c.id} style={s.customerResultRow} onPress={() => selectCustomer(c)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.customerSelectedName}>{c.name}</Text>
                    <Text style={s.customerSelectedPoints}>{c.phone || t("customers.noPhone")}</Text>
                  </View>
                  {loyaltyEnabled && (
                    <View style={s.pointsBadge}>
                      <Ionicons name="star" size={11} color={C.accent} />
                      <Text style={s.pointsBadgeText}>{c.loyaltyPoints}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
              {customerResults.length === 0 && customerSearch.trim().length > 0 && (
                <TouchableOpacity
                  style={s.addNewCustomerBtn}
                  onPress={() => quickCreateCustomer(customerSearch.trim())}
                >
                  <Ionicons name="add-circle-outline" size={17} color={C.accent} />
                  <Text style={s.addNewCustomerText}>
                    {t("payment.addCustomerNamed", { name: customerSearch.trim() })}
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity style={s.modalCancelBtn} onPress={() => setCustomerModalOpen(false)}>
              <Text style={s.modalCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Summary row ──────────────────────────────────────────────────────────────

const SumRow = ({
  label, value, dim, accent, green, large, s, C,
}: {
  label: string; value: string;
  dim?: boolean; accent?: boolean; green?: boolean; large?: boolean;
  s: Styles; C: ThemeColors;
}) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
    <Text style={[s.sumLabel, dim && { color: C.muted }]}>{label}</Text>
    <Text style={[
      s.sumValue,
      dim    && { color: C.muted },
      accent && { color: C.accent },
      green  && { color: C.success },
      large  && { fontSize: F.xl, fontWeight: "800" },
    ]}>{value}</Text>
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (C: ThemeColors, isTablet: boolean) => StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center",
            backgroundColor: C.bg, gap: 12 },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  scroll: { padding: 16, gap: 14, paddingBottom: 24, width: "100%" },
  scrollTablet: { maxWidth: 640 },

  header:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10) },
  backBtn: { width: 34, height: 34, borderRadius: R.md, backgroundColor: C.card,
             alignItems: "center", justifyContent: "center",
             borderWidth: 1, borderColor: C.border },
  title:   { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

  card:    { backgroundColor: C.surface, borderRadius: R.lg, padding: 16,
             borderWidth: 1, borderColor: C.border, ...Shadow.sm },
  section: { color: C.muted, fontSize: F.xs, fontWeight: "700",
             textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },

  row:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  rowLabel: { color: C.text, fontSize: F.sm },
  rowQty:   { color: C.muted },
  rowAmt:   { color: C.accent, fontSize: F.sm, fontWeight: "700" },
  rowAmtCol: { alignItems: "flex-end" },
  rowAmtStrike: { color: C.muted, fontSize: F.xs, textDecorationLine: "line-through" },
  rowDiscountNote: { color: C.warning, fontSize: F.xs, marginTop: 2 },
  rowDiscountBtn:  { paddingHorizontal: 8, paddingVertical: 4 },

  input: { backgroundColor: C.card, borderRadius: R.md, padding: 14,
           color: C.text, fontSize: F.xl, borderWidth: 1, borderColor: C.border },

  selectCustomerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                       backgroundColor: C.card, borderRadius: R.md, paddingVertical: 12,
                       borderWidth: 1, borderColor: C.border, borderStyle: "dashed" },
  selectCustomerText: { color: C.accent, fontSize: F.sm, fontWeight: "700" },
  customerSelectedRow: { flexDirection: "row", alignItems: "center" },
  customerSelectedName: { color: C.text, fontSize: F.sm, fontWeight: "700" },
  customerSelectedPoints: { color: C.muted, fontSize: F.xs, marginTop: 2 },
  redeemLabel: { color: C.textSub, fontSize: F.xs, fontWeight: "600", marginBottom: 6 },
  redeemHint:  { color: C.success, fontSize: F.xs, fontWeight: "700", marginTop: 6 },

  sheetOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
           padding: 20, maxHeight: "80%", gap: 12, ...Shadow.lg },
  customerResultsList: { maxHeight: 280 },
  customerResultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10,
                       borderBottomWidth: 1, borderBottomColor: C.border },
  pointsBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: C.accentSoft,
                 borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 4 },
  pointsBadgeText: { color: C.accent, fontSize: F.xs, fontWeight: "800" },
  addNewCustomerBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  addNewCustomerText: { color: C.accent, fontSize: F.sm, fontWeight: "700" },

  discountTypeRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  discountTypeBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: R.md,
                     backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  discountTypeActive:     { backgroundColor: C.accent, borderColor: C.accent },
  discountTypeText:       { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  discountTypeActiveText: { color: C.accentFg },

  methodRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodBtn:       { flexGrow: 1, flexBasis: "45%", paddingVertical: 12, borderRadius: R.md,
                     backgroundColor: C.card, alignItems: "center", gap: 6,
                     borderWidth: 1, borderColor: C.border },
  methodActive:    { backgroundColor: C.accent, borderColor: C.accent },
  methodText:      { color: C.muted, fontSize: F.sm, fontWeight: "700" },
  methodActiveText:{ color: C.accentFg },

  splitRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingVertical: 6 },
  splitLabel: { color: C.text, fontSize: F.sm, fontWeight: "600" },
  splitInput: { backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8,
                color: C.text, fontSize: F.md, borderWidth: 1, borderColor: C.border, minWidth: 100, textAlign: "right" },
  splitRemain:   { fontSize: F.sm, fontWeight: "700", textAlign: "right", marginTop: 8 },
  splitRemainOk: { color: C.success },
  splitRemainBad:{ color: C.danger },

  quickRow:        { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  quickBtn:        { paddingHorizontal: 14, paddingVertical: 8,
                     backgroundColor: C.card, borderRadius: R.md,
                     borderWidth: 1, borderColor: C.border },
  quickActive:     { backgroundColor: C.accent, borderColor: C.accent },
  quickText:       { color: C.text, fontSize: F.sm, fontWeight: "600" },
  quickActiveText: { color: C.accentFg },

  divider:  { height: 1, backgroundColor: C.border, marginVertical: 4 },
  sumLabel: { color: C.text, fontSize: F.md },
  sumValue: { color: C.text, fontSize: F.md, fontWeight: "600" },

  errorText: { color: C.danger, fontSize: F.md, textAlign: "center", paddingHorizontal: 24 },
  retryBtn: { marginTop: 4, backgroundColor: C.card, paddingHorizontal: 20,
              paddingVertical: 10, borderRadius: R.md },
  retryText: { color: C.accent, fontSize: F.sm, fontWeight: "600" },

  payBar:  { flexDirection: "row", alignItems: "center", gap: 12,
             paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
             backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border,
             ...Shadow.lg },
  payBarAmtCol: { flex: 1 },
  payBarLabel:  { color: C.muted, fontSize: F.xs, fontWeight: "700",
                  textTransform: "uppercase", letterSpacing: 0.6 },
  payBarAmt:    { color: C.text, fontSize: F.xxl, fontWeight: "800", marginTop: 2 },

  payBtn:  { backgroundColor: C.accent, borderRadius: R.lg,
             paddingVertical: 15, paddingHorizontal: 22, alignItems: "center", justifyContent: "center",
             flexDirection: "row", gap: 8, ...Shadow.md },
  payOff:  { opacity: 0.4 },
  payText: { color: C.accentFg, fontSize: F.lg, fontWeight: "800" },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", padding: 24 },
  modalBox: { backgroundColor: C.surface, borderRadius: R.lg, padding: 18, width: "100%", maxWidth: 340,
              gap: 12, borderWidth: 1, borderColor: C.border, ...Shadow.lg },
  modalTitle: { color: C.text, fontSize: F.md, fontWeight: "700" },
  modalBtnRow: { flexDirection: "row", gap: 10 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.card,
                    alignItems: "center", borderWidth: 1, borderColor: C.border },
  modalCancelText: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },
  modalConfirmBtn: { flex: 1, paddingVertical: 12, borderRadius: R.md, backgroundColor: C.accent,
                     alignItems: "center" },
  modalConfirmText: { color: C.accentFg, fontSize: F.sm, fontWeight: "700" },
});
