import React, { useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  ScrollView,
  Modal,
  Image,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useProductStore } from "../../src/store/productStore";
import { useCartStore } from "../../src/store/cartStore";
import { salesRepo } from "../../src/db/salesRepo";
import { useBranchStore } from "../../src/store/branchStore";
import { useAuthStore } from "../../src/store/authStore";
import { isAdmin } from "../../src/utils/permissions";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { productsRepo } from "../../src/db/productsRepo";
import { BarcodeScannerModal } from "../../src/components/BarcodeScannerModal";
import { HardwareScannerListener } from "../../src/components/HardwareScannerListener";
import type { TranslationKey } from "../../src/i18n/translations";
import { F, R, Shadow, ThemeColors, withAlpha } from "../../src/theme";
import type { Product } from "../../src/types";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

// Products expiring at or before this many days from today count toward the
// alerts banner's "expiring soon" total — already-past-expiry ones are
// counted (and blocked from sale) separately.
const EXPIRING_SOON_DAYS = 30;
const isExpired = (p: Product) => !!p.expiryDate && p.expiryDate < new Date().toISOString().slice(0, 10);

// ─── Picker Modal ─────────────────────────────────────────────────────────────

// One list-in-a-box picker, used for both the category and the branch.
//
// Categories used to be a horizontal strip of chips. A strip only shows
// the two or three categories that happen to fit, hides the rest behind a
// sideways swipe nobody thinks to try, and has to be told how tall one
// chip is — which is what put the chips on top of the product grid, since
// a Myanmar label's line box is taller than the Latin one the paddings
// were measured against. A picker has none of those problems: every
// category is visible at once, in a list that sizes itself.
const PickerModal = ({
  visible, title, options, selectedId, onSelect, onClose, cancelLabel, s, C,
}: {
  visible: boolean;
  title: string;
  options: { id: number; label: string; meta?: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
  cancelLabel: string;
  s: Styles; C: ThemeColors;
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={s.pickerOverlay}>
      <View style={s.pickerBox}>
        <Text style={s.pickerTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {options.map(opt => {
            const active = opt.id === selectedId;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[s.pickerRow, active && s.pickerRowActive]}
                onPress={() => onSelect(opt.id)}
                activeOpacity={0.75}
              >
                <Text style={[s.pickerText, active && s.pickerTextActive]} numberOfLines={1}>
                  {opt.label}
                </Text>
                {!!opt.meta && <Text style={s.pickerMeta}>{opt.meta}</Text>}
                {active && <Ionicons name="checkmark" size={16} color={C.accent} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity style={s.pickerCloseBtn} onPress={onClose}>
          <Text style={s.pickerCloseText}>{cancelLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

// ─── Product Card ─────────────────────────────────────────────────────────────

const ProductCard = ({
  item, qty, onPress, s, C, t,
}: {
  item: Product; qty: number; onPress: () => void; s: Styles; C: ThemeColors;
  t: T;
}) => {
  const expired = isExpired(item);
  const outOfStock = item.stockQty <= 0;
  const lowStock = !outOfStock && item.stockQty <= item.lowStockThreshold;
  const disabled = outOfStock || expired;
  return (
    <TouchableOpacity
      style={[s.productCard, disabled && s.productCardOff]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      {/* The image and the text below it are one bordered, rounded card
          now. They used to be a bordered image tile with the name, price
          and stock line loose underneath it, sitting straight on the page
          — so a row of products read as a row of pictures with captions
          drifting below rather than as things you can tap. */}
      <View style={s.productImageWrap}>
        {item.imageUri
          ? <Image source={{ uri: item.imageUri }} style={s.productImage} resizeMode="cover" />
          : <Ionicons name="cube-outline" size={26} color={C.muted} />
        }
        {qty > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{qty}</Text>
          </View>
        )}
        {(expired || outOfStock) && (
          <View style={[s.statusTag, expired && s.statusTagExpired]}>
            <Text style={s.statusTagText} numberOfLines={1}>
              {expired ? t("alerts.expiredBadge") : t("pos.outOfStock")}
            </Text>
          </View>
        )}
      </View>
      <View style={s.productCardBody}>
        <Text style={s.productName} numberOfLines={1}>{item.name}</Text>
        <View style={s.productPriceRow}>
          <Text style={s.productPrice} numberOfLines={1}>${item.price.toLocaleString()}</Text>
          <Text style={s.productUnit} numberOfLines={1}>/{item.unit}</Text>
        </View>
        {!outOfStock && !expired && (
          <Text style={[s.stockLabel, lowStock && s.stockLabelWarn]}>
            {t("pos.inStock", { qty: item.stockQty })}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

// ─── Cart Row ─────────────────────────────────────────────────────────────────

const CartRow = ({
  name, unit, price, qty, onInc, onDec, s, C,
}: {
  name: string; unit: string; price: number; qty: number;
  onInc: () => void; onDec: () => void; s: Styles; C: ThemeColors;
}) => (
  <View style={s.cartRow}>
    <View style={{ flex: 1 }}>
      <Text style={s.cartName} numberOfLines={1}>{name}</Text>
      <Text style={s.cartSub}>${(price * qty).toLocaleString()} ({unit})</Text>
    </View>
    <View style={s.qtyRow}>
      <TouchableOpacity style={s.qtyBtn} onPress={onDec}>
        <Ionicons name="remove" size={16} color={C.text} />
      </TouchableOpacity>
      <Text style={s.qtyNum}>{qty}</Text>
      <TouchableOpacity style={s.qtyBtn} onPress={onInc}>
        <Ionicons name="add" size={16} color={C.text} />
      </TouchableOpacity>
    </View>
  </View>
);

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PosScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isCompact, isTablet, gridColumns, height } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);

  const {
    categories, selectedCategoryId, isLoading, error,
    load, selectCategory, activeItems,
  } = useProductStore();
  const { cart, addItem, setQty, clearCart, total, itemCount, getQty, priceMode, setPriceMode } = useCartStore();
  const { branches, currentBranchId, setCurrentBranch, isLocked } = useBranchStore();
  const { user } = useAuthStore();

  const [cartOpen, setCartOpen] = React.useState(false);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [branchModalOpen, setBranchModalOpen] = React.useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [todaySales, setTodaySales] = React.useState({ total: 0, count: 0 });

  useEffect(() => { load(); }, [currentBranchId]);

  // Refetched on focus (not just on mount/branch change) so it picks up the
  // sale that was just rung up on payment.tsx the moment the cashier lands
  // back here — a plain effect wouldn't rerun on that return trip since
  // nothing this screen reads from currentBranchId etc. actually changes.
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      salesRepo.getTodayTotal(currentBranchId ?? undefined).then(result => {
        if (!cancelled) setTodaySales(result);
      });
      return () => { cancelled = true; };
    }, [currentBranchId])
  );

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setCartOpen(false);
    router.push("/(pos)/payment");
  };

  const handleClearCart = () => {
    if (cart.length === 0) return;
    alert(t("pos.clearCartConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.confirm"), style: "destructive", onPress: clearCart },
    ]);
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setScannerOpen(false);
    if (!currentBranchId) return;
    const product = await productsRepo.getByBarcode(barcode, currentBranchId);
    if (!product) {
      alert(t("pos.notFoundTitle"), t("pos.notFoundMsg", { barcode }));
      return;
    }
    if (product.stockQty <= 0) {
      alert(t("pos.outOfStockTitle"), t("pos.outOfStockMsg", { name: product.name }));
      return;
    }
    if (isExpired(product)) {
      alert(t("common.error"), t("payment.expiredProduct", { name: product.name }));
      return;
    }
    addItem(product);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={s.loadingText}>{t("pos.loadingProducts")}</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.errorText}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={load}>
          <Text style={s.retryText}>{t("common.retry")}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  const items = isSearching
    ? categories.flatMap(c => c.products).filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.sku?.toLowerCase().includes(query) ||
        p.barcode?.toLowerCase().includes(query)
      )
    : activeItems();

  const handleSelectCategory = (id: number) => {
    setSearch("");
    selectCategory(id);
  };

  const currentBranch = branches.find(b => b.id === currentBranchId);
  const currentCategory = categories.find(c => c.id === selectedCategoryId);

  const allProducts = categories.flatMap(c => c.products);
  const hasWholesaleProducts = allProducts.some(p => p.wholesalePrice != null);
  const soonStr = new Date(Date.now() + EXPIRING_SOON_DAYS * 86400000).toISOString().slice(0, 10);
  const lowStockCount = allProducts.filter(p => p.stockQty <= p.lowStockThreshold).length;
  const expiryAlertCount = allProducts.filter(p => !!p.expiryDate && p.expiryDate <= soonStr).length;
  const alertCount = lowStockCount + expiryAlertCount;

  // The helpers below (through BranchPickerModal) are called as plain
  // functions in the JSX further down — e.g. `{SearchBar()}`, never
  // `<SearchBar />`. Rendering them as JSX elements would make React treat
  // each one as its own component type, and since they're redeclared on
  // every PosScreen render, every keystroke in the search box would
  // unmount+remount the whole tree under them — which is exactly what was
  // dropping focus out of the search input after a single character.
  // Calling them as functions inlines their output into this render
  // instead, so there's no separate component identity to lose.
  // Today's takings and the stock alerts used to be two full-width banners
  // stacked above the search box, each with its own border and padding —
  // between them they pushed the first row of products most of the way
  // down a phone screen, on a screen whose entire job is tapping products.
  // One bar now: the running total reads across it, with the alert count
  // as a chip on the right.
  const showAlerts = isAdmin(user) && alertCount > 0;
  const showSales = todaySales.count > 0;

  const SummaryBar = () => {
    if (!showSales && !showAlerts) return null;

    // Reports is admin-only, so a cashier sees the same running total with
    // no link that would bounce them straight back here. When there are no
    // sales yet the alerts take the bar over rather than leaving a chip
    // stranded on an otherwise empty row.
    const primary = showSales
      ? { icon: "trending-up" as const, tint: C.success, route: "/(pos)/reports",
          text: t("pos.todaySales", { amount: todaySales.total.toLocaleString(), count: todaySales.count }),
          enabled: isAdmin(user) }
      : { icon: "warning" as const, tint: C.warning, route: "/(pos)/alerts",
          text: t("alerts.bannerText", { count: alertCount }), enabled: true };

    return (
      <View style={s.summaryBar}>
        <TouchableOpacity
          style={s.summaryMain}
          onPress={() => router.push(primary.route as never)}
          disabled={!primary.enabled}
          activeOpacity={0.8}
        >
          <View style={[s.summaryIcon, { backgroundColor: withAlpha(primary.tint, 0.14) }]}>
            <Ionicons name={primary.icon} size={15} color={primary.tint} />
          </View>
          <Text style={[s.summaryText, { color: primary.tint }]} numberOfLines={1}>{primary.text}</Text>
        </TouchableOpacity>

        {showAlerts && showSales && (
          <TouchableOpacity style={s.alertChip} onPress={() => router.push("/(pos)/alerts")} activeOpacity={0.8}>
            <Ionicons name="warning" size={13} color={C.warning} />
            <Text style={s.alertChipText}>{alertCount}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const HeaderBar = () => (
    <View style={s.header}>
      <View style={s.headerLeft}>
        <View style={s.logoBadge}>
          <Ionicons name="storefront" size={18} color={C.accent} />
        </View>
        <Text style={s.headerTitle} numberOfLines={1}>{t("app.name")}</Text>
      </View>
      <View style={s.headerActions}>
        {branches.length > 1 && !isLocked && (
          <TouchableOpacity style={s.branchPill} onPress={() => setBranchModalOpen(true)}>
            <Ionicons name="business-outline" size={13} color={C.accent} />
            <Text style={s.branchPillText} numberOfLines={1}>{currentBranch?.name}</Text>
          </TouchableOpacity>
        )}
        {isLocked && !!currentBranch && (
          <View style={s.branchPill}>
            <Ionicons name="business-outline" size={13} color={C.accent} />
            <Text style={s.branchPillText} numberOfLines={1}>{currentBranch.name}</Text>
          </View>
        )}
        <TouchableOpacity style={s.iconBtn} onPress={() => setScannerOpen(true)}>
          <Ionicons name="barcode-outline" size={18} color={C.textSub} />
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.push("/(pos)/settings")}>
          <Ionicons name="settings-outline" size={18} color={C.textSub} />
        </TouchableOpacity>
      </View>
    </View>
  );

  // Search and the category picker share one row: two controls that both
  // narrow the same grid, and one row of chrome instead of two on a screen
  // whose job is showing products.
  const SearchBar = () => (
    <View style={s.searchRow}>
      <View style={s.searchBox}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={t("pos.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {isSearching && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>

      {categories.length > 0 && (
        <TouchableOpacity style={s.catBtn} onPress={() => setCategoryModalOpen(true)} activeOpacity={0.8}>
          <Text style={s.catBtnText} numberOfLines={1}>
            {currentCategory?.name ?? t("pos.category")}
          </Text>
          <Ionicons name="chevron-down" size={14} color={C.accent} />
        </TouchableOpacity>
      )}
    </View>
  );

  const ProductGrid = () => (
    <FlatList
      key={gridColumns}
      data={items}
      keyExtractor={(i) => String(i.id)}
      numColumns={gridColumns}
      // The floating cart bar is absolutely positioned over this list, so
      // without an inset the size of it the last row of products sits
      // underneath the bar and cannot be tapped. Only the compact layout
      // has that bar — the tablet layout keeps the cart in a side panel.
      contentContainerStyle={[s.grid, isCompact && itemCount() > 0 && s.gridUnderCartBar]}
      renderItem={({ item }) => (
        <ProductCard
          item={item}
          qty={getQty(item.id)}
          onPress={() => addItem(item)}
          s={s}
          C={C}
          t={t}
        />
      )}
      ListEmptyComponent={
        <Text style={s.emptyText}>
          {isSearching ? t("pos.searchNoResults", { query: search.trim() }) : t("pos.noProducts")}
        </Text>
      }
    />
  );

  const PriceModeToggle = () =>
    hasWholesaleProducts ? (
      <View style={s.priceModeRow}>
        <TouchableOpacity
          style={[s.priceModeBtn, priceMode === "retail" && s.priceModeBtnActive]}
          onPress={() => setPriceMode("retail")}
        >
          <Text style={[s.priceModeText, priceMode === "retail" && s.priceModeTextActive]}>
            {t("pos.retailPrice")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.priceModeBtn, priceMode === "wholesale" && s.priceModeBtnActive]}
          onPress={() => setPriceMode("wholesale")}
        >
          <Text style={[s.priceModeText, priceMode === "wholesale" && s.priceModeTextActive]}>
            {t("pos.wholesalePrice")}
          </Text>
        </TouchableOpacity>
      </View>
    ) : null;

  const CartList = () =>
    cart.length === 0 ? (
      <View style={s.cartEmpty}>
        <View style={s.cartEmptyIcon}>
          <Ionicons name="cart-outline" size={30} color={C.accent} />
        </View>
        <Text style={s.cartEmptyText}>{t("pos.selectItems")}</Text>
      </View>
    ) : (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {cart.map((item) => (
          <CartRow
            key={item.productId}
            name={item.name}
            unit={item.unit}
            price={item.price}
            qty={item.qty}
            onInc={() => setQty(item.productId, item.qty + 1)}
            onDec={() => setQty(item.productId, item.qty - 1)}
            s={s}
            C={C}
          />
        ))}
      </ScrollView>
    );

  const CartFooter = () => (
    <View style={s.cartFooter}>
      <View style={s.totalRow}>
        <Text style={s.totalLabel}>{t("common.total")}</Text>
        <Text style={s.totalAmt}>${total().toLocaleString()}</Text>
      </View>
      <TouchableOpacity
        style={[s.checkoutBtn, cart.length === 0 && s.btnOff]}
        onPress={handleCheckout}
        disabled={cart.length === 0}
        activeOpacity={0.85}
      >
        <Ionicons name="card-outline" size={19} color={C.accentFg} />
        <Text style={s.checkoutText}>{t("pos.checkout")}</Text>
      </TouchableOpacity>
    </View>
  );

  const BranchPickerModal = () => (
    <PickerModal
      visible={branchModalOpen}
      title={t("branches.switchTo")}
      options={branches.map(b => ({ id: b.id, label: b.name }))}
      selectedId={currentBranchId}
      onSelect={id => { setCurrentBranch(id); setBranchModalOpen(false); }}
      onClose={() => setBranchModalOpen(false)}
      cancelLabel={t("common.cancel")}
      s={s} C={C}
    />
  );

  const CategoryPickerModal = () => (
    <PickerModal
      visible={categoryModalOpen}
      title={t("pos.selectCategory")}
      options={categories.map(c => ({ id: c.id, label: c.name, meta: String(c.products.length) }))}
      selectedId={isSearching ? null : selectedCategoryId}
      onSelect={id => { handleSelectCategory(id); setCategoryModalOpen(false); }}
      onClose={() => setCategoryModalOpen(false)}
      cancelLabel={t("common.cancel")}
      s={s} C={C}
    />
  );

  if (isCompact) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.menuPanelFull}>
          {HeaderBar()}
          {SummaryBar()}
          {SearchBar()}
          {ProductGrid()}
        </View>

        {itemCount() > 0 && (
          <TouchableOpacity style={s.cartBar} onPress={() => setCartOpen(true)} activeOpacity={0.85}>
            <View style={s.cartBarBadge}>
              <Text style={s.cartBarBadgeText}>{itemCount()}</Text>
            </View>
            <Text style={s.cartBarText}>{t("pos.cart")}</Text>
            <Text style={s.cartBarTotal}>${total().toLocaleString()}</Text>
          </TouchableOpacity>
        )}

        <Modal visible={cartOpen} animationType="slide" transparent onRequestClose={() => setCartOpen(false)}>
          <View style={s.modalOverlay}>
            <View style={[s.modalSheet, { height: height * 0.8 }]}>
              <View style={s.modalHandleRow}>
                <View style={s.modalHandle} />
              </View>
              <View style={s.modalHeaderRow}>
                <Text style={s.cartTitle}>{t("pos.cart")} {itemCount() > 0 ? `(${itemCount()})` : ""}</Text>
                <View style={s.cartHeaderActions}>
                  {cart.length > 0 && (
                    <TouchableOpacity onPress={handleClearCart} style={s.clearBtn}>
                      <Text style={s.clearBtnText}>{t("pos.clearCart")}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setCartOpen(false)}>
                    <Ionicons name="close" size={22} color={C.muted} />
                  </TouchableOpacity>
                </View>
              </View>
              {PriceModeToggle()}
              {CartList()}
              {CartFooter()}
            </View>
          </View>
        </Modal>

        <BarcodeScannerModal
          visible={scannerOpen}
          onScanned={handleBarcodeScanned}
          onClose={() => setScannerOpen(false)}
        />
        <HardwareScannerListener enabled={!scannerOpen && !searchFocused} onScan={handleBarcodeScanned} />
        {BranchPickerModal()}
        {CategoryPickerModal()}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <HardwareScannerListener enabled={!scannerOpen} onScan={handleBarcodeScanned} />
      <BarcodeScannerModal
        visible={scannerOpen}
        onScanned={handleBarcodeScanned}
        onClose={() => setScannerOpen(false)}
      />
      {BranchPickerModal()}
      {CategoryPickerModal()}
      <View style={s.container}>
        <View style={s.menuPanel}>
          {HeaderBar()}
          {SummaryBar()}
          {SearchBar()}
          {ProductGrid()}
        </View>
        <View style={s.cartPanel}>
          <View style={s.cartHeaderRow}>
            <Text style={s.cartTitle}>{t("pos.cart")} {itemCount() > 0 ? `(${itemCount()})` : ""}</Text>
            {cart.length > 0 && (
              <TouchableOpacity onPress={handleClearCart} style={s.clearBtn}>
                <Text style={s.clearBtnText}>{t("pos.clearCart")}</Text>
              </TouchableOpacity>
            )}
          </View>
          {PriceModeToggle()}
          {CartList()}
          {CartFooter()}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.bg, gap: 12 },
    container: { flex: 1, flexDirection: "row" },

    loadingText: { color: C.muted, fontSize: F.sm, marginTop: 8 },
    errorText: { color: C.danger, fontSize: F.md, textAlign: "center", paddingHorizontal: 24 },
    retryBtn: { marginTop: 12, backgroundColor: C.card, paddingHorizontal: 20, paddingVertical: 10, borderRadius: R.md },
    retryText: { color: C.accent, fontSize: F.sm, fontWeight: "600" },

    menuPanel: { flex: 2, borderRightWidth: 1, borderRightColor: C.border },
    menuPanelFull: { flex: 1 },

    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 14, paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10),
      paddingBottom: isTablet ? 6 : 10, gap: 8,
      borderBottomWidth: 1, borderBottomColor: C.border,
    },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
    logoBadge: {
      width: isTablet ? 28 : 34, height: isTablet ? 28 : 34, borderRadius: R.md,
      backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center",
    },
    headerTitle: { fontSize: isTablet ? F.md : F.lg, fontWeight: "800", color: C.text, flexShrink: 1 },
    headerActions: { flexDirection: "row", gap: 6, alignItems: "center" },
    iconBtn: {
      backgroundColor: C.card, width: isTablet ? 30 : 36, height: isTablet ? 30 : 36,
      borderRadius: R.md, alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: C.border,
    },
    branchPill: {
      flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 110,
      backgroundColor: C.accentSoft, paddingHorizontal: 10, height: isTablet ? 30 : 36,
      borderRadius: R.full,
    },
    branchPillText: { color: C.accent, fontSize: F.xs, fontWeight: "700", flexShrink: 1 },

    pickerOverlay: { flex: 1, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center", padding: 24 },
    pickerBox: { backgroundColor: C.surface, borderRadius: R.xl, padding: 16, width: "100%", maxWidth: 340,
                 borderWidth: 1, borderColor: C.border, ...Shadow.lg },
    pickerTitle: { color: C.muted, fontSize: F.xs, fontWeight: "800",
                   textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
    pickerRow: { flexDirection: "row", alignItems: "center", gap: 10,
                 paddingVertical: 12, paddingHorizontal: 12, borderRadius: R.md },
    pickerRowActive: { backgroundColor: C.accentSoft },
    pickerText: { color: C.text, fontSize: F.md, fontWeight: "600", flex: 1 },
    pickerTextActive: { color: C.accent, fontWeight: "800" },
    pickerMeta: { color: C.muted, fontSize: F.xs, fontWeight: "700" },
    pickerCloseBtn: { marginTop: 8, paddingVertical: 12, alignItems: "center",
                      borderRadius: R.md, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
    pickerCloseText: { color: C.textSub, fontSize: F.sm, fontWeight: "700" },

    summaryBar: {
      flexDirection: "row", alignItems: "center", gap: 8,
      marginHorizontal: 12, marginTop: isTablet ? 6 : 8,
      backgroundColor: C.surface, borderRadius: R.lg,
      paddingHorizontal: 8, paddingVertical: 6,
      borderWidth: 1, borderColor: C.border, ...Shadow.sm,
    },
    summaryMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
    summaryIcon: { width: 26, height: 26, borderRadius: R.sm, alignItems: "center", justifyContent: "center" },
    summaryText: { flex: 1, fontSize: isTablet ? F.xs : F.sm, fontWeight: "700" },
    alertChip: {
      flexDirection: "row", alignItems: "center", gap: 4,
      backgroundColor: withAlpha(C.warning, 0.14), borderRadius: R.full,
      paddingHorizontal: 10, paddingVertical: 5,
    },
    alertChipText: { color: C.warning, fontSize: F.xs, fontWeight: "800" },

    searchRow: { flexDirection: "row", alignItems: "stretch", gap: 8,
                 marginHorizontal: 12, marginTop: isTablet ? 6 : 8 },
    searchBox: {
      flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
      backgroundColor: C.card, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: isTablet ? 6 : 9,
      borderWidth: 1, borderColor: C.border,
    },
    searchInput: { flex: 1, color: C.text, fontSize: isTablet ? F.sm : F.md, padding: 0 },

    catBtn: {
      flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 150,
      backgroundColor: C.accentSoft, borderRadius: R.md, paddingHorizontal: 12,
      borderWidth: 1, borderColor: C.accentSoft,
    },
    catBtnText: { color: C.accent, fontSize: isTablet ? F.xs : F.sm, fontWeight: "700", flexShrink: 1 },

    grid: { padding: 8, gap: 8 },
    // Bar height (~50) + its 14 bottom offset + a little air.
    gridUnderCartBar: { paddingBottom: 78 },
    productCard: {
      flex: 1, margin: 4, backgroundColor: C.surface, borderRadius: R.lg,
      borderWidth: 1, borderColor: C.border, overflow: "hidden", ...Shadow.sm,
    },
    productCardOff: { opacity: 0.45 },
    productImageWrap: {
      width: "100%", height: isTablet ? 72 : 100,
      backgroundColor: C.card,
      alignItems: "center", justifyContent: "center",
    },
    productImage: { width: "100%", height: "100%" },
    productCardBody: { padding: isTablet ? 7 : 9 },
    productName: { color: C.text, fontSize: isTablet ? F.xs : F.sm, fontWeight: "700", marginBottom: 3 },
    productPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 3 },
    productPrice: { color: C.accent, fontSize: isTablet ? F.sm : F.md, fontWeight: "800", flexShrink: 1 },
    productUnit: { color: C.muted, fontSize: F.xs, fontWeight: "600" },
    stockLabel: { color: C.muted, fontSize: F.xs, marginTop: 3 },
    stockLabelWarn: { color: C.warning, fontWeight: "700" },
    // Sold out / expired reads on the image, where the eye already is, so
    // the body below stays the same three lines tall on every card and the
    // grid's rows keep their baselines.
    // Neutral for out of stock, red only for expired. A shop can easily
    // have most of its catalogue out of stock at once, and a red band on
    // every card in the grid turns the whole screen into a warning —
    // whereas expiry is genuinely something that has gone wrong.
    statusTag: {
      position: "absolute", left: 0, right: 0, bottom: 0,
      backgroundColor: withAlpha(C.text, 0.72), paddingVertical: 3, paddingHorizontal: 6,
    },
    statusTagExpired: { backgroundColor: withAlpha(C.danger, 0.92) },
    statusTagText: { color: "#fff", fontSize: F.xs, fontWeight: "800", textAlign: "center" },
    badge: {
      position: "absolute", top: 6, right: 6, minWidth: 22, height: 22, borderRadius: 11,
      paddingHorizontal: 6,
      backgroundColor: C.accent, alignItems: "center", justifyContent: "center", ...Shadow.sm,
    },
    badgeText: { color: C.accentFg, fontSize: F.xs, fontWeight: "800" },
    emptyText: { color: C.muted, textAlign: "center", marginTop: 48, fontSize: F.sm },

    cartPanel: { flex: 1, backgroundColor: C.surface, padding: isTablet ? 12 : 16 },
    cartHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    cartHeaderActions: { flexDirection: "row", alignItems: "center", gap: 12 },
    cartTitle: { fontSize: isTablet ? F.lg : F.xl, fontWeight: "700", color: C.text },
    clearBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.md,
                backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
    clearBtnText: { color: C.danger, fontSize: F.xs, fontWeight: "700" },
    cartEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    cartEmptyIcon: {
      width: 64, height: 64, borderRadius: 32, backgroundColor: C.accentSoft,
      alignItems: "center", justifyContent: "center",
    },
    cartEmptyText: { color: C.muted, fontSize: F.sm },

    priceModeRow: { flexDirection: "row", backgroundColor: C.card, borderRadius: R.md,
                    padding: 3, marginBottom: 10, borderWidth: 1, borderColor: C.border },
    priceModeBtn: { flex: 1, paddingVertical: 7, borderRadius: R.sm, alignItems: "center" },
    priceModeBtnActive: { backgroundColor: C.accent },
    priceModeText: { color: C.muted, fontSize: F.xs, fontWeight: "700" },
    priceModeTextActive: { color: C.accentFg },

    cartRow: {
      flexDirection: "row", alignItems: "center", paddingVertical: isTablet ? 7 : 10,
      borderBottomWidth: 1, borderBottomColor: C.border,
    },
    cartName: { color: C.text, fontSize: isTablet ? F.xs : F.sm, fontWeight: "600" },
    cartSub: { color: C.accent, fontSize: isTablet ? F.xs : F.sm, marginTop: 2 },

    qtyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 8 },
    qtyBtn: {
      width: isTablet ? 26 : 30, height: isTablet ? 26 : 30, borderRadius: 15,
      backgroundColor: C.card, alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: C.border,
    },
    qtyNum: { color: C.text, fontSize: F.md, fontWeight: "700", minWidth: 22, textAlign: "center" },

    cartFooter: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: isTablet ? 10 : 14 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    totalLabel: { color: C.muted, fontSize: F.md },
    totalAmt: { color: C.text, fontSize: isTablet ? F.xl : F.xxl, fontWeight: "800" },

    checkoutBtn: {
      backgroundColor: C.accent, borderRadius: R.lg, paddingVertical: isTablet ? 11 : 15,
      alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, ...Shadow.md,
    },
    btnOff: { opacity: 0.4 },
    checkoutText: { color: C.accentFg, fontSize: isTablet ? F.md : F.lg, fontWeight: "800" },

    cartBar: {
      position: "absolute", left: 14, right: 14, bottom: 14, backgroundColor: C.accent,
      borderRadius: R.lg, paddingVertical: 14, paddingHorizontal: 16,
      flexDirection: "row", alignItems: "center", gap: 10, ...Shadow.lg,
    },
    cartBarBadge: {
      backgroundColor: C.accentFg, width: 24, height: 24, borderRadius: 12,
      alignItems: "center", justifyContent: "center",
    },
    cartBarBadgeText: { color: C.accent, fontSize: F.xs, fontWeight: "800" },
    cartBarText: { color: C.accentFg, fontSize: F.md, fontWeight: "700", flex: 1 },
    cartBarTotal: { color: C.accentFg, fontSize: F.md, fontWeight: "800" },

    modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
    modalSheet: {
      backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
      padding: 16, ...Shadow.lg,
    },
    modalHandleRow: { alignItems: "center", marginBottom: 8 },
    modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },
    modalHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  });
