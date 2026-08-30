import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  Switch,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { productsRepo } from "../../src/db/productsRepo";
import { useProductStore } from "../../src/store/productStore";
import { useAuthStore } from "../../src/store/authStore";
import { useBranchStore } from "../../src/store/branchStore";
import { useShopStore } from "@/store/shopStore";
import { usePrinterStore } from "@/store/printerStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { isAdmin } from "../../src/utils/permissions";
import {
  pickProductImage,
  deleteProductImage,
} from "../../src/utils/productImage";
import { F, R, Shadow, ThemeColors } from "../../src/theme";
import type { Category, Product } from "../../src/types";
import { useResponsive } from "@/hooks/useResponsive";
import { LabelPrinter, LabelPrinterHandle } from "@/components/LabelPrinter";
import { DatePickerModal } from "@/components/DatePickerModal";

interface ProductFormState {
  mode: "create" | "edit";
  categoryId: number;
  productId?: number;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  wholesalePrice: string;
  costPrice: string;
  unit: string;
  imageUri: string;
  stockQty: string;
  lowStockThreshold: string;
  expiryDate: string;
  labelText: string;
  isActive: boolean;
}

interface LabelFormState {
  product: Product;
  qty: string;
}

// Quick-pick chips for the Unit field — free text otherwise, this is just a
// shortcut for the common cases.
const COMMON_UNITS = [
  "pcs",
  "kg",
  "g",
  "box",
  "dozen",
  "litre",
  "pack",
  "bottle",
];

interface CategoryFormState {
  mode: "create" | "edit";
  categoryId?: number;
  name: string;
}

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

// Products expiring within this many days are flagged the same as the
// Alerts screen's "expiring soon" section.
const EXPIRING_SOON_DAYS = 30;

export default function ProductsManageScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);

  const { user } = useAuthStore();
  const { branches, currentBranchId } = useBranchStore();
  const shopSettings = useShopStore((state) => state.settings);
  const loadShopSettings = useShopStore((state) => state.load);
  const initPrinter = usePrinterStore((state) => state.init);
  const labelPrinterRef = useRef<LabelPrinterHandle>(null);
  const currentBranch = branches.find((b) => b.id === currentBranchId);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const refreshHomeCatalog = useProductStore((state) => state.load);
  const todayStr = new Date().toISOString().slice(0, 10);
  const expiringSoonStr = new Date(Date.now() + EXPIRING_SOON_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);

  const load = async () => {
    if (!currentBranchId) return;
    setIsLoading(true);
    try {
      setCategories(await productsRepo.getAllCategories(currentBranchId));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [currentBranchId]);
  useEffect(() => {
    loadShopSettings();
    initPrinter();
  }, []);

  const reload = async () => {
    await load();
    refreshHomeCatalog();
  };

  // Filters each category's own product list rather than the category list
  // itself — a category stays visible as long as at least one of its
  // products matches, and drops out entirely once none do.
  const searchQuery = search.trim().toLowerCase();
  const visibleCategories =
    searchQuery.length === 0
      ? categories
      : categories
          .map((cat) => ({
            ...cat,
            products: cat.products.filter(
              (p) =>
                p.name.toLowerCase().includes(searchQuery) ||
                (p.sku ?? "").toLowerCase().includes(searchQuery) ||
                (p.barcode ?? "").toLowerCase().includes(searchQuery),
            ),
          }))
          .filter((cat) => cat.products.length > 0);

  // Per-category render window — a category with hundreds of products was
  // rendering every single row at once. Keyed by category id so expanding
  // one category doesn't affect the others; resets whenever the search
  // narrows/widens what's visible.
  const PRODUCTS_PAGE_SIZE = 30;
  const [visibleCounts, setVisibleCounts] = useState<Record<number, number>>(
    {},
  );
  useEffect(() => {
    setVisibleCounts({});
  }, [searchQuery]);
  const visibleCountFor = (categoryId: number) =>
    visibleCounts[categoryId] ?? PRODUCTS_PAGE_SIZE;
  const showMoreFor = (categoryId: number) =>
    setVisibleCounts((prev) => ({
      ...prev,
      [categoryId]: visibleCountFor(categoryId) + PRODUCTS_PAGE_SIZE,
    }));

  // ── Category form (create / rename) ──────────────────────────────────────
  const [catForm, setCatForm] = useState<CategoryFormState | null>(null);
  const [catSubmitting, setCatSubmitting] = useState(false);

  const openCreateCategory = () => setCatForm({ mode: "create", name: "" });
  const openEditCategory = (cat: Category) =>
    setCatForm({ mode: "edit", categoryId: cat.id, name: cat.name });

  const submitCategory = async () => {
    if (!catForm || !catForm.name.trim()) return;
    setCatSubmitting(true);
    try {
      if (catForm.mode === "create") {
        // Always local-first — sync_uuid is generated on insert (see
        // productsRepo.createCategory), so an offline device's category
        // pushes itself up the next time this device syncs, same as a
        // sale created offline does. No online-only path needed here.
        await productsRepo.createCategory(catForm.name.trim());
      } else if (catForm.categoryId) {
        const original = categories.find((c) => c.id === catForm.categoryId);
        await productsRepo.updateCategory(catForm.categoryId, {
          name: catForm.name.trim(),
          sortOrder: original?.sortOrder ?? 0,
          isActive: original?.isActive ?? true,
        });
      }
      setCatForm(null);
      reload();
    } catch (e: any) {
      alert(t("common.error"), e?.message ?? "");
    } finally {
      setCatSubmitting(false);
    }
  };

  const deleteCategory = (cat: Category) => {
    alert(t("products.deleteCategoryConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: async () => {
          await productsRepo.deleteCategory(cat.id);
          reload();
        },
      },
    ]);
  };

  // ── Product form (create / edit) ─────────────────────────────────────────
  const [itemForm, setItemForm] = useState<ProductFormState | null>(null);
  const [itemSubmitting, setItemSubmitting] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const openCreateItem = (categoryId: number) => {
    setItemForm({
      mode: "create",
      categoryId,
      name: "",
      sku: "",
      barcode: "",
      price: "",
      wholesalePrice: "",
      costPrice: "0",
      unit: "pcs",
      imageUri: "",
      stockQty: "0",
      lowStockThreshold: "5",
      expiryDate: "",
      labelText: "",
      isActive: true,
    });
  };

  const openEditItem = (item: Product) => {
    setItemForm({
      mode: "edit",
      categoryId: item.categoryId,
      productId: item.id,
      name: item.name,
      sku: item.sku ?? "",
      barcode: item.barcode ?? "",
      price: String(item.price),
      wholesalePrice:
        item.wholesalePrice != null ? String(item.wholesalePrice) : "",
      costPrice: String(item.costPrice),
      unit: item.unit,
      imageUri: item.imageUri ?? "",
      stockQty: String(item.stockQty),
      lowStockThreshold: String(item.lowStockThreshold),
      expiryDate: item.expiryDate ?? "",
      labelText: item.labelText ?? "",
      isActive: item.isActive,
    });
  };

  const submitItem = async () => {
    if (
      !itemForm ||
      !itemForm.name.trim() ||
      !itemForm.price ||
      !currentBranchId
    )
      return;
    const price = Number(itemForm.price);
    const costPrice = Number(itemForm.costPrice) || 0;
    const unit = itemForm.unit.trim() || "pcs";
    const stockQty = Number(itemForm.stockQty) || 0;
    const lowStockThreshold = Number(itemForm.lowStockThreshold) || 0;
    const expiryDate = itemForm.expiryDate.trim() || undefined;
    if (Number.isNaN(price) || price < 0) return;
    const wholesalePriceStr = itemForm.wholesalePrice.trim();
    const wholesalePrice = wholesalePriceStr
      ? Number(wholesalePriceStr)
      : undefined;
    if (
      wholesalePrice !== undefined &&
      (Number.isNaN(wholesalePrice) || wholesalePrice < 0)
    ) {
      alert(t("common.error"), t("products.wholesalePriceInvalid"));
      return;
    }
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      alert(t("common.error"), t("products.expiryDateInvalid"));
      return;
    }

    setItemSubmitting(true);
    try {
      if (itemForm.mode === "create") {
        const category = categories.find((c) => c.id === itemForm.categoryId);
        const sortOrder = category?.products.length ?? 0;
        // Always local-first — sync_uuid is generated on insert (see
        // productsRepo.createProduct), so an offline device's product
        // pushes itself up the next time this device syncs, same as a
        // sale created offline does.
        await productsRepo.createProduct(
          currentBranchId,
          {
            categoryId: itemForm.categoryId,
            name: itemForm.name.trim(),
            sku: itemForm.sku.trim() || undefined,
            barcode: itemForm.barcode.trim() || undefined,
            price,
            wholesalePrice,
            costPrice,
            unit,
            imageUri: itemForm.imageUri || undefined,
            stockQty,
            lowStockThreshold,
            expiryDate,
            labelText: itemForm.labelText.trim() || undefined,
            sortOrder,
          },
          user?.name,
        );
      } else if (itemForm.productId) {
        const original = categories
          .find((c) => c.id === itemForm.categoryId)
          ?.products.find((i) => i.id === itemForm.productId);
        await productsRepo.updateProduct(
          itemForm.productId,
          currentBranchId,
          {
            name: itemForm.name.trim(),
            sku: itemForm.sku.trim() || undefined,
            barcode: itemForm.barcode.trim() || undefined,
            price,
            wholesalePrice,
            costPrice,
            unit,
            imageUri: itemForm.imageUri || undefined,
            stockQty,
            lowStockThreshold,
            expiryDate,
            labelText: itemForm.labelText.trim() || undefined,
            isActive: itemForm.isActive,
            sortOrder: original?.sortOrder ?? 0,
          },
          user?.name,
        );
      }
      setItemForm(null);
      reload();
    } catch (e: any) {
      alert(t("common.error"), e?.message ?? "");
    } finally {
      setItemSubmitting(false);
    }
  };

  const toggleAvailable = async (item: Product) => {
    if (!currentBranchId) return;
    await productsRepo.updateProduct(item.id, currentBranchId, {
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      price: item.price,
      wholesalePrice: item.wholesalePrice,
      costPrice: item.costPrice,
      unit: item.unit,
      imageUri: item.imageUri,
      stockQty: item.stockQty,
      lowStockThreshold: item.lowStockThreshold,
      expiryDate: item.expiryDate,
      labelText: item.labelText,
      isActive: !item.isActive,
      sortOrder: item.sortOrder,
    });
    reload();
  };

  const deleteItem = (item: Product) => {
    alert(t("products.deleteConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: async () => {
          await productsRepo.deleteProduct(item.id);
          await deleteProductImage(item.imageUri);
          reload();
        },
      },
    ]);
  };

  // ── Product photo ─────────────────────────────────────────────────────────
  const [imagePicking, setImagePicking] = useState(false);

  const handlePickImage = async () => {
    setImagePicking(true);
    try {
      const uri = await pickProductImage();
      if (uri) setItemForm((f) => f && { ...f, imageUri: uri });
    } catch (e: any) {
      const message =
        e?.message === "PERMISSION_DENIED"
          ? t("products.imagePermission")
          : t("products.imageFailed");
      alert(t("common.error"), message);
    } finally {
      setImagePicking(false);
    }
  };

  const handleRemoveImage = () => {
    alert(t("products.removePhotoConfirm"), "", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => setItemForm((f) => f && { ...f, imageUri: "" }),
      },
    ]);
  };

  // ── Barcode label printing ────────────────────────────────────────────────
  const [labelForm, setLabelForm] = useState<LabelFormState | null>(null);
  const [labelPrinting, setLabelPrinting] = useState(false);

  const openPrintLabel = (item: Product) =>
    setLabelForm({ product: item, qty: "1" });

  const submitPrintLabel = async () => {
    if (!labelForm) return;
    const qty = Math.max(1, Math.min(100, Number(labelForm.qty) || 1));
    setLabelPrinting(true);
    try {
      await labelPrinterRef.current?.print({
        name: labelForm.product.name,
        price: labelForm.product.price,
        currency: shopSettings?.currency ?? "$",
        barcode: labelForm.product.barcode,
        // `||`, not `??`: a product whose label_text is an empty string
        // (rather than NULL) means "nothing set for this product" just as
        // much as NULL does, and `??` would keep the empty string and
        // print a blank strip instead of falling through to the shop
        // default. Rows can hold "" from a sync pull or a restored backup.
        labelText:
          labelForm.product.labelText || shopSettings?.labelDefaultText || "",
        qty,
      });
      setLabelForm(null);
    } catch (e: any) {
      alert(
        t("common.error"),
        e?.message === "NO_PRINTER_SELECTED"
          ? t("products.noLabelPrinter")
          : t("products.printLabelFailed"),
      );
    } finally {
      setLabelPrinting(false);
    }
  };

  // Cashiers can open this screen too, but browse-only — every create/
  // edit/delete/toggle affordance below is gated on canEdit.
  const canEdit = isAdmin(user);
  if (!user) return <Redirect href="/(pos)/" />;

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.textSub} />
        </TouchableOpacity>
        <Ionicons name="cube-outline" size={17} color={C.text} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{t("products.title")}</Text>
          {!!currentBranch && branches.length > 1 && (
            <Text style={s.branchSubtitle}>{currentBranch.name}</Text>
          )}
        </View>
        {canEdit && (
          <TouchableOpacity style={s.addBtn} onPress={openCreateCategory}>
            <Ionicons name="add" size={16} color={C.accentFg} />
            <Text style={s.addBtnText}>{t("products.newCategory")}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={16} color={C.muted} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("products.searchPlaceholder")}
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {categories.length === 0 && (
            <Text style={s.emptyText}>{t("products.noCategories")}</Text>
          )}
          {categories.length > 0 && visibleCategories.length === 0 && (
            <Text style={s.emptyText}>{t("products.noSearchResults")}</Text>
          )}

          {visibleCategories.map((cat) => (
            <View key={cat.id} style={s.catCard}>
              <View style={s.catHeader}>
                {canEdit ? (
                  <TouchableOpacity
                    style={s.catNameRow}
                    onPress={() => openEditCategory(cat)}
                  >
                    <Text style={s.catName} numberOfLines={1}>
                      {cat.name}
                    </Text>
                    <Ionicons name="pencil-outline" size={13} color={C.muted} />
                  </TouchableOpacity>
                ) : (
                  <View style={s.catNameRow}>
                    <Text style={s.catName} numberOfLines={1}>
                      {cat.name}
                    </Text>
                  </View>
                )}
                {canEdit && (
                  <View style={s.catHeaderActions}>
                    <TouchableOpacity
                      style={s.addItemBtn}
                      onPress={() => openCreateItem(cat.id)}
                    >
                      <Ionicons name="add" size={13} color={C.muted} />
                      <Text style={s.addItemBtnText}>
                        {t("products.addProduct")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.catDeleteBtn}
                      onPress={() => deleteCategory(cat)}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={15}
                        color={C.danger}
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {cat.products.length === 0 ? (
                <Text style={s.noItemsText}>{t("products.noItems")}</Text>
              ) : (
                cat.products.slice(0, visibleCountFor(cat.id)).map((item) => (
                  <View
                    key={item.id}
                    style={[s.itemRow, !item.isActive && { opacity: 0.5 }]}
                  >
                    {item.imageUri ? (
                      <Image
                        source={{ uri: item.imageUri }}
                        style={s.itemThumb}
                      />
                    ) : (
                      <View style={s.itemThumbPlaceholder}>
                        <Ionicons
                          name="cube-outline"
                          size={16}
                          color={C.muted}
                        />
                      </View>
                    )}
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => canEdit && openEditItem(item)}
                      disabled={!canEdit}
                    >
                      <Text style={s.itemName}>{item.name}</Text>
                      <Text style={s.itemPrice}>
                        ${item.price.toLocaleString()} / {item.unit}
                        {item.wholesalePrice != null
                          ? ` · ${t("products.wholesalePrice")}: $${item.wholesalePrice.toLocaleString()}`
                          : ""}
                        {" · "}
                        {t("products.stock")}: {item.stockQty}
                      </Text>
                      {/* The code is on the list, not only inside the edit
                        form. A shopkeeper who has just turned on automatic
                        numbering has no way to tell it worked otherwise, and
                        the barcode is what they check against the label they
                        are about to stick on. */}
                      {(item.barcode || item.sku) && (
                        <Text style={s.itemCode}>
                          {item.barcode ?? ""}
                          {item.barcode && item.sku ? "  ·  " : ""}
                          {item.sku ?? ""}
                        </Text>
                      )}
                      {item.stockQty <= 0 ? (
                        <Text style={s.stockBadgeDanger}>
                          {t("inventory.outOfStock")}
                        </Text>
                      ) : item.stockQty <= item.lowStockThreshold ? (
                        <Text style={s.stockBadgeWarning}>
                          {t("inventory.lowStock")}
                        </Text>
                      ) : null}
                      {!!item.expiryDate && item.expiryDate < todayStr ? (
                        <Text style={s.stockBadgeDanger}>
                          {t("alerts.expired")}
                        </Text>
                      ) : !!item.expiryDate &&
                        item.expiryDate <= expiringSoonStr ? (
                        <Text style={s.stockBadgeWarning}>
                          {t("alerts.expiringSoon")}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                    {canEdit && (
                      <>
                        <Switch
                          value={item.isActive}
                          onValueChange={() => toggleAvailable(item)}
                          trackColor={{ false: C.border, true: C.accent }}
                          thumbColor="#fff"
                        />
                        <TouchableOpacity
                          style={s.deleteBtn}
                          onPress={() => openPrintLabel(item)}
                        >
                          <Ionicons
                            name="pricetag-outline"
                            size={14}
                            color={C.textSub}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.deleteBtn}
                          onPress={() => deleteItem(item)}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={14}
                            color={C.danger}
                          />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ))
              )}
              {cat.products.length > visibleCountFor(cat.id) && (
                <TouchableOpacity
                  style={s.loadMoreBtn}
                  onPress={() => showMoreFor(cat.id)}
                >
                  <Text style={s.loadMoreBtnText}>
                    {t("common.loadMore")} (
                    {cat.products.length - visibleCountFor(cat.id)})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Category modal (create / rename) */}
      <Modal
        visible={!!catForm}
        animationType="slide"
        transparent
        onRequestClose={() => setCatForm(null)}
      >
        <View style={s.modalOverlay}>
          {catForm && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>
                {catForm.mode === "create"
                  ? t("products.newCategoryTitle")
                  : t("products.renameCategoryTitle")}
              </Text>
              <TextInput
                style={s.input}
                value={catForm.name}
                onChangeText={(v) => setCatForm((f) => f && { ...f, name: v })}
                placeholder={t("products.categoryNamePlaceholder")}
                placeholderTextColor={C.muted}
              />
              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => setCatForm(null)}
                >
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.saveBtn, !catForm.name.trim() && s.saveBtnOff]}
                  onPress={submitCategory}
                  disabled={!catForm.name.trim() || catSubmitting}
                >
                  {catSubmitting ? (
                    <ActivityIndicator color={C.accentFg} />
                  ) : (
                    <Text style={s.saveBtnText}>{t("common.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Product modal */}
      <Modal
        visible={!!itemForm}
        animationType="slide"
        transparent
        onRequestClose={() => setItemForm(null)}
      >
        <View style={s.modalOverlay}>
          {itemForm && (
            <ScrollView
              style={s.modalSheet}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.modalTitle}>
                {itemForm.mode === "create"
                  ? t("products.addProductTitle")
                  : t("products.editProductTitle")}
              </Text>

              <Text style={s.label}>{t("products.image")}</Text>
              <View style={s.photoRow}>
                {itemForm.imageUri ? (
                  <Image
                    source={{ uri: itemForm.imageUri }}
                    style={s.photoPreview}
                  />
                ) : (
                  <View style={s.photoPlaceholder}>
                    <Ionicons name="image-outline" size={26} color={C.muted} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 8 }}>
                  <TouchableOpacity
                    style={s.photoBtn}
                    onPress={handlePickImage}
                    disabled={imagePicking}
                  >
                    {imagePicking ? (
                      <ActivityIndicator color={C.text} size="small" />
                    ) : (
                      <>
                        <Ionicons
                          name="camera-outline"
                          size={15}
                          color={C.text}
                        />
                        <Text style={s.photoBtnText}>
                          {itemForm.imageUri
                            ? t("products.changePhoto")
                            : t("products.addPhoto")}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                  {itemForm.imageUri && (
                    <TouchableOpacity
                      style={s.photoRemoveBtn}
                      onPress={handleRemoveImage}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={15}
                        color={C.danger}
                      />
                      <Text style={s.photoRemoveBtnText}>
                        {t("products.removePhoto")}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <Text style={[s.label, { marginTop: 12 }]}>
                {t("products.name")}
              </Text>
              <TextInput
                style={s.input}
                value={itemForm.name}
                onChangeText={(v) => setItemForm((f) => f && { ...f, name: v })}
                placeholderTextColor={C.muted}
              />

              <Text style={[s.label, { marginTop: 12 }]}>
                {t("products.sku")}
              </Text>
              <TextInput
                style={s.input}
                value={itemForm.sku}
                onChangeText={(v) => setItemForm((f) => f && { ...f, sku: v })}
                placeholderTextColor={C.muted}
                autoCapitalize="characters"
              />

              <Text style={[s.label, { marginTop: 12 }]}>
                {t("products.barcode")}
              </Text>
              <TextInput
                style={s.input}
                value={itemForm.barcode}
                onChangeText={(v) =>
                  setItemForm((f) => f && { ...f, barcode: v })
                }
                placeholderTextColor={C.muted}
                keyboardType="numeric"
              />

              <View style={s.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { marginTop: 12 }]}>
                    {t("products.price")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={itemForm.price}
                    onChangeText={(v) =>
                      setItemForm((f) => f && { ...f, price: v })
                    }
                    keyboardType="numeric"
                    placeholderTextColor={C.muted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { marginTop: 12 }]}>
                    {t("products.costPrice")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={itemForm.costPrice}
                    onChangeText={(v) =>
                      setItemForm((f) => f && { ...f, costPrice: v })
                    }
                    keyboardType="numeric"
                    placeholderTextColor={C.muted}
                  />
                </View>
              </View>

              <View style={s.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { marginTop: 12 }]}>
                    {t("products.wholesalePrice")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={itemForm.wholesalePrice}
                    onChangeText={(v) =>
                      setItemForm((f) => f && { ...f, wholesalePrice: v })
                    }
                    keyboardType="numeric"
                    placeholder={t("products.wholesalePriceOptional")}
                    placeholderTextColor={C.muted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { marginTop: 12 }]}>
                    {t("products.unit")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={itemForm.unit}
                    onChangeText={(v) =>
                      setItemForm((f) => f && { ...f, unit: v })
                    }
                    placeholder="pcs"
                    placeholderTextColor={C.muted}
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={s.unitChipsRow}>
                {COMMON_UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[
                      s.unitChip,
                      itemForm.unit === u && s.unitChipActive,
                    ]}
                    onPress={() => setItemForm((f) => f && { ...f, unit: u })}
                  >
                    <Text
                      style={[
                        s.unitChipText,
                        itemForm.unit === u && s.unitChipTextActive,
                      ]}
                    >
                      {u}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { marginTop: 12 }]}>
                    {t("products.stock")}
                    {branches.length > 1 && currentBranch
                      ? ` (${currentBranch.name})`
                      : ""}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={itemForm.stockQty}
                    onChangeText={(v) =>
                      setItemForm((f) => f && { ...f, stockQty: v })
                    }
                    keyboardType="numeric"
                    placeholderTextColor={C.muted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.label, { marginTop: 12 }]}>
                    {t("inventory.lowStockThreshold")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={itemForm.lowStockThreshold}
                    onChangeText={(v) =>
                      setItemForm((f) => f && { ...f, lowStockThreshold: v })
                    }
                    keyboardType="numeric"
                    placeholderTextColor={C.muted}
                  />
                </View>
              </View>

              <Text style={[s.label, { marginTop: 12 }]}>
                {t("products.expiryDate")}
              </Text>
              <TouchableOpacity
                style={s.input}
                onPress={() => setDatePickerOpen(true)}
                activeOpacity={0.7}
              >
                <Text
                  style={
                    itemForm.expiryDate
                      ? s.dateValueText
                      : s.dateValuePlaceholder
                  }
                >
                  {itemForm.expiryDate || t("products.expiryDatePlaceholder")}
                </Text>
              </TouchableOpacity>

              <Text style={[s.label, { marginTop: 12 }]}>
                {t("products.labelText")}
              </Text>
              <TextInput
                style={s.input}
                value={itemForm.labelText}
                onChangeText={(v) =>
                  setItemForm((f) => f && { ...f, labelText: v })
                }
                placeholder={
                  shopSettings?.labelDefaultText ||
                  t("products.labelTextPlaceholder")
                }
                placeholderTextColor={C.muted}
              />

              {itemForm.mode === "edit" && (
                <View style={s.availRow}>
                  <Text style={s.label}>{t("products.active")}</Text>
                  <Switch
                    value={itemForm.isActive}
                    onValueChange={(v) =>
                      setItemForm((f) => f && { ...f, isActive: v })
                    }
                    trackColor={{ false: C.border, true: C.accent }}
                    thumbColor="#fff"
                  />
                </View>
              )}

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => setItemForm(null)}
                >
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    s.saveBtn,
                    (!itemForm.name.trim() || !itemForm.price) && s.saveBtnOff,
                  ]}
                  onPress={submitItem}
                  disabled={
                    !itemForm.name.trim() || !itemForm.price || itemSubmitting
                  }
                >
                  {itemSubmitting ? (
                    <ActivityIndicator color={C.accentFg} />
                  ) : (
                    <Text style={s.saveBtnText}>{t("common.save")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Print label modal */}
      <Modal
        visible={!!labelForm}
        animationType="slide"
        transparent
        onRequestClose={() => setLabelForm(null)}
      >
        <View style={s.modalOverlay}>
          {labelForm && (
            <View style={s.modalSheet}>
              <Text style={s.modalTitle}>{t("products.printLabelTitle")}</Text>
              <Text style={s.labelPreviewName}>{labelForm.product.name}</Text>
              {!labelForm.product.barcode && (
                <Text style={s.labelNoBarcodeHint}>
                  {t("products.labelNoBarcodeHint")}
                </Text>
              )}

              <Text style={[s.label, { marginTop: 12 }]}>
                {t("products.labelQty")}
              </Text>
              <TextInput
                style={s.input}
                value={labelForm.qty}
                onChangeText={(v) => setLabelForm((f) => f && { ...f, qty: v })}
                keyboardType="numeric"
                placeholderTextColor={C.muted}
              />

              <View style={s.modalActions}>
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => setLabelForm(null)}
                >
                  <Text style={s.cancelBtnText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.saveBtn}
                  onPress={submitPrintLabel}
                  disabled={labelPrinting}
                >
                  {labelPrinting ? (
                    <ActivityIndicator color={C.accentFg} />
                  ) : (
                    <Text style={s.saveBtnText}>
                      {t("products.printLabelAction")}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <LabelPrinter ref={labelPrinterRef} />

      <DatePickerModal
        visible={datePickerOpen}
        value={itemForm?.expiryDate}
        onSelect={(date) => setItemForm((f) => f && { ...f, expiryDate: date })}
        onClear={() => setItemForm((f) => f && { ...f, expiryDate: "" })}
        onClose={() => setDatePickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 16,
      paddingBottom: 8,
      paddingTop: ANDROID_STATUS_BAR + (isTablet ? 6 : 10),
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    title: { fontSize: F.lg, fontWeight: "700", color: C.text },
    branchSubtitle: {
      color: C.accent,
      fontSize: F.xs,
      fontWeight: "700",
      marginTop: 2,
    },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: C.accent,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: R.md,
    },
    addBtnText: { color: C.accentFg, fontSize: F.xs, fontWeight: "800" },

    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 8,
      backgroundColor: C.card,
      borderRadius: R.md,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: C.border,
    },
    searchInput: { flex: 1, color: C.text, fontSize: F.md, padding: 0 },

    scroll: { padding: 16, paddingTop: 8, gap: 12 },
    emptyText: {
      color: C.muted,
      textAlign: "center",
      marginTop: 60,
      fontSize: F.sm,
    },

    catCard: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 14,
      borderWidth: 1,
      borderColor: C.border,
      marginBottom: 12,
      ...Shadow.sm,
    },
    catHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
      gap: 8,
    },
    catNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexShrink: 1,
    },
    catName: {
      color: C.text,
      fontSize: F.lg,
      fontWeight: "800",
      flexShrink: 1,
    },
    catHeaderActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    addItemBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: C.card,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    addItemBtnText: { color: C.muted, fontSize: F.xs, fontWeight: "700" },
    catDeleteBtn: {
      width: 30,
      height: 30,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },

    noItemsText: {
      color: C.muted,
      fontSize: F.xs,
      paddingVertical: 10,
      textAlign: "center",
    },

    loadMoreBtn: {
      marginTop: 6,
      paddingVertical: 10,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    loadMoreBtnText: { color: C.text, fontSize: F.xs, fontWeight: "700" },

    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: C.border,
    },
    itemThumb: {
      width: 40,
      height: 40,
      borderRadius: R.md,
      backgroundColor: C.card,
    },
    itemThumbPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    itemName: { color: C.text, fontSize: F.sm, fontWeight: "600" },
    itemCode: {
      color: C.muted,
      fontSize: F.xs,
      marginTop: 2,
      letterSpacing: 0.4,
    },
    itemPrice: {
      color: C.accent,
      fontSize: F.sm,
      fontWeight: "700",
      marginTop: 2,
    },
    stockBadgeDanger: {
      color: C.danger,
      fontSize: F.xs,
      fontWeight: "700",
      marginTop: 2,
    },
    stockBadgeWarning: {
      color: C.warning,
      fontSize: F.xs,
      fontWeight: "700",
      marginTop: 2,
    },
    deleteBtn: {
      width: 32,
      height: 32,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "flex-end",
    },
    modalSheet: {
      backgroundColor: C.surface,
      borderTopLeftRadius: R.xl,
      borderTopRightRadius: R.xl,
      padding: 20,
      maxHeight: "88%",
      ...Shadow.lg,
    },
    modalTitle: {
      color: C.text,
      fontSize: F.lg,
      fontWeight: "800",
      marginBottom: 14,
    },
    labelPreviewName: { color: C.text, fontSize: F.md, fontWeight: "700" },
    labelNoBarcodeHint: { color: C.warning, fontSize: F.xs, marginTop: 6 },

    row2: { flexDirection: "row", gap: 12 },

    unitChipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8,
    },
    unitChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: R.full,
      backgroundColor: C.card,
      borderWidth: 1,
      borderColor: C.border,
    },
    unitChipActive: { backgroundColor: C.accent, borderColor: C.accent },
    unitChipText: { color: C.muted, fontSize: F.xs, fontWeight: "600" },
    unitChipTextActive: { color: C.accentFg, fontWeight: "700" },

    photoRow: { flexDirection: "row", gap: 12, alignItems: "center" },
    photoPreview: {
      width: 64,
      height: 64,
      borderRadius: R.md,
      backgroundColor: C.card,
    },
    photoPlaceholder: {
      width: 64,
      height: 64,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    photoBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: C.card,
      paddingVertical: 9,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    photoBtnText: { color: C.text, fontSize: F.xs, fontWeight: "700" },
    photoRemoveBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 6,
    },
    photoRemoveBtnText: { color: C.danger, fontSize: F.xs, fontWeight: "700" },

    label: {
      color: C.textSub,
      fontSize: F.sm,
      fontWeight: "600",
      marginBottom: 6,
    },
    input: {
      backgroundColor: C.card,
      borderRadius: R.md,
      padding: 12,
      color: C.text,
      fontSize: F.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    dateValueText: { color: C.text, fontSize: F.md },
    dateValuePlaceholder: { color: C.muted, fontSize: F.md },

    availRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 14,
    },

    modalActions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 20,
      marginBottom: 20,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: R.md,
      backgroundColor: C.card,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.border,
    },
    cancelBtnText: { color: C.muted, fontSize: F.sm, fontWeight: "700" },
    saveBtn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: R.md,
      backgroundColor: C.accent,
      alignItems: "center",
    },
    saveBtnOff: { opacity: 0.4 },
    saveBtnText: { color: C.accentFg, fontSize: F.sm, fontWeight: "800" },
  });
