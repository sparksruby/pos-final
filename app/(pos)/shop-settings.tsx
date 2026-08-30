import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { shopRepo } from "../../src/db/shopRepo";
import { useShopStore } from "@/store/shopStore";
import { useAuthStore } from "../../src/store/authStore";
import { useTheme } from "../../src/context/ThemeContext";
import { useLanguage } from "../../src/context/LanguageContext";
import { useAlert } from "@/context/AlertContext";
import { useResponsive } from "../../src/hooks/useResponsive";
import { isAdmin } from "../../src/utils/permissions";
import { F, R, Shadow, ThemeColors } from "../../src/theme";

const ANDROID_STATUS_BAR =
  Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function ShopSettingsScreen() {
  const { colors: C } = useTheme();
  const { t } = useLanguage();
  const { alert } = useAlert();
  const { isTablet } = useResponsive();
  const s = React.useMemo(() => makeStyles(C, isTablet), [C, isTablet]);
  const { user } = useAuthStore();
  const setStoreSettings = useShopStore((state) => state.setSettings);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [currency, setCurrency] = useState("");
  const [taxPercent, setTaxPercent] = useState("0");
  const [receiptHeader, setReceiptHeader] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  const [labelDefaultText, setLabelDefaultText] = useState("");
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyEarnRate, setLoyaltyEarnRate] = useState("1");
  const [loyaltyRedeemRate, setLoyaltyRedeemRate] = useState("0.01");
  const [autoBarcodeEnabled, setAutoBarcodeEnabled] = useState(false);
  const [autoBarcodePrefix, setAutoBarcodePrefix] = useState("2");
  const [autoBarcodeNext, setAutoBarcodeNext] = useState("1");
  const [autoSkuEnabled, setAutoSkuEnabled] = useState(false);
  const [autoSkuPrefix, setAutoSkuPrefix] = useState("SKU");
  const [autoSkuNext, setAutoSkuNext] = useState("1");
  const [autoCodeTill, setAutoCodeTill] = useState("1");

  useEffect(() => {
    shopRepo
      .get()
      .then((settings) => {
        setName(settings.name ?? "");
        setAddress(settings.address ?? "");
        setPhone(settings.phone ?? "");
        setCurrency(settings.currency ?? "");
        setTaxPercent(String(settings.taxPercent ?? 0));
        setReceiptHeader(settings.receiptHeader ?? "");
        setReceiptFooter(settings.receiptFooter ?? "");
        setLabelDefaultText(settings.labelDefaultText ?? "");
        setLoyaltyEnabled(settings.loyaltyEnabled);
        setLoyaltyEarnRate(String(settings.loyaltyEarnRate));
        setLoyaltyRedeemRate(String(settings.loyaltyRedeemRate));
        setAutoBarcodeEnabled(settings.autoBarcodeEnabled);
        setAutoBarcodePrefix(settings.autoBarcodePrefix);
        setAutoBarcodeNext(String(settings.autoBarcodeNext));
        setAutoSkuEnabled(settings.autoSkuEnabled);
        setAutoSkuPrefix(settings.autoSkuPrefix);
        setAutoSkuNext(String(settings.autoSkuNext));
        setAutoCodeTill(String(settings.autoCodeTill));
      })
      .catch(() => alert(t("common.error"), t("shopSettings.loadFailed")))
      .finally(() => setLoading(false));
  }, []);

  if (!isAdmin(user)) return <Redirect href="/(pos)/" />;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await shopRepo.update({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        taxPercent: Math.max(0, Number(taxPercent) || 0),
        currency: currency.trim(),
        receiptHeader: receiptHeader.trim(),
        receiptFooter: receiptFooter.trim(),
        labelDefaultText: labelDefaultText.trim(),
        loyaltyEnabled,
        loyaltyEarnRate: Math.max(0, Number(loyaltyEarnRate) || 0),
        loyaltyRedeemRate: Math.max(0, Number(loyaltyRedeemRate) || 0),
        autoBarcodeEnabled,
        autoBarcodePrefix: autoBarcodePrefix.replace(/[^0-9]/g, "") || "2",
        autoBarcodeNext: Math.max(1, Number(autoBarcodeNext) || 1),
        autoSkuEnabled,
        autoSkuPrefix: autoSkuPrefix.replace(/[^A-Za-z0-9-]/g, "") || "SKU",
        autoSkuNext: Math.max(1, Number(autoSkuNext) || 1),
        autoCodeTill: Math.max(1, Number(autoCodeTill) || 1),
      });
      setStoreSettings(updated);
      alert(t("shopSettings.saved"));
    } catch (e: any) {
      alert(t("common.error"), e?.message ?? "");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.scrollOuter}>
        <View style={[s.scroll, isTablet && s.scrollTablet]}>
          <View style={s.header}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color={C.textSub} />
            </TouchableOpacity>
            <Text style={s.title}>{t("shopSettings.title")}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.section}>{t("shopSettings.info")}</Text>
            <Field
              s={s}
              C={C}
              label={t("shopSettings.name")}
              value={name}
              onChangeText={setName}
            />
            <Field
              s={s}
              C={C}
              label={t("shopSettings.address")}
              value={address}
              onChangeText={setAddress}
              multiline
            />
            <Field
              s={s}
              C={C}
              label={t("shopSettings.phone")}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Field
              s={s}
              C={C}
              label={t("shopSettings.currency")}
              value={currency}
              onChangeText={setCurrency}
              placeholder="$"
              autoCapitalize="characters"
            />
          </View>

          <View style={s.card}>
            <Text style={s.section}>{t("shopSettings.charges")}</Text>
            <Field
              s={s}
              C={C}
              label={t("shopSettings.tax")}
              value={taxPercent}
              onChangeText={setTaxPercent}
              keyboardType="numeric"
            />
          </View>

          <View style={s.card}>
            <Text style={s.section}>{t("shopSettings.receipt")}</Text>
            <Field
              s={s}
              C={C}
              label={t("shopSettings.receiptHeader")}
              value={receiptHeader}
              onChangeText={setReceiptHeader}
              multiline
            />
            <Field
              s={s}
              C={C}
              label={t("shopSettings.receiptFooter")}
              value={receiptFooter}
              onChangeText={setReceiptFooter}
              multiline
            />
          </View>

          <View style={s.card}>
            <Text style={s.section}>{t("shopSettings.labelPrinting")}</Text>
            <Field
              s={s}
              C={C}
              label={t("shopSettings.labelDefaultText")}
              value={labelDefaultText}
              onChangeText={setLabelDefaultText}
            />
            <Text style={s.loyaltyHint}>
              {t("shopSettings.labelDefaultTextHint")}
            </Text>
          </View>

          <View style={s.card}>
            <View style={s.loyaltyHeaderRow}>
              <Text style={[s.section, { marginBottom: 0 }]}>
                {t("shopSettings.loyalty")}
              </Text>
              <Switch
                value={loyaltyEnabled}
                onValueChange={setLoyaltyEnabled}
                trackColor={{ false: C.border, true: C.accent }}
                thumbColor="#fff"
              />
            </View>
            {loyaltyEnabled && (
              <>
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.loyaltyEarnRate")}
                  value={loyaltyEarnRate}
                  onChangeText={setLoyaltyEarnRate}
                  keyboardType="numeric"
                />
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.loyaltyRedeemRate")}
                  value={loyaltyRedeemRate}
                  onChangeText={setLoyaltyRedeemRate}
                  keyboardType="numeric"
                />
                <Text style={s.loyaltyHint}>
                  {t("shopSettings.loyaltyHint", { currency: currency || "$" })}
                </Text>
              </>
            )}
          </View>

          <View style={s.card}>
            <View style={s.loyaltyHeaderRow}>
              <Text style={[s.section, { marginBottom: 0 }]}>
                {t("shopSettings.autoBarcode")}
              </Text>
              <Switch
                value={autoBarcodeEnabled}
                onValueChange={setAutoBarcodeEnabled}
                trackColor={{ false: C.border, true: C.accent }}
                thumbColor="#fff"
              />
            </View>
            <Text style={s.loyaltyHint}>{t("shopSettings.autoCodeHint")}</Text>

            {autoBarcodeEnabled && (
              <>
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.autoCodePrefix")}
                  value={autoBarcodePrefix}
                  onChangeText={(v) =>
                    setAutoBarcodePrefix(v.replace(/[^0-9]/g, ""))
                  }
                  keyboardType="numeric"
                />
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.autoCodeNext")}
                  value={autoBarcodeNext}
                  onChangeText={setAutoBarcodeNext}
                  keyboardType="numeric"
                />
                <Text style={s.autoCodePreview}>
                  {`${autoBarcodePrefix || "2"}${autoCodeTill || "1"}${String(Math.max(1, Number(autoBarcodeNext) || 1)).padStart(5, "0")}`}
                </Text>
                <Text style={s.loyaltyHint}>
                  {t("shopSettings.autoBarcodePrefixHint")}
                </Text>
              </>
            )}
            {(autoBarcodeEnabled || autoSkuEnabled) && (
              <>
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.autoCodeTill")}
                  value={autoCodeTill}
                  onChangeText={setAutoCodeTill}
                  keyboardType="numeric"
                />
                <Text style={s.loyaltyHint}>
                  {t("shopSettings.autoCodeTillHint")}
                </Text>
              </>
            )}

            <View style={[s.loyaltyHeaderRow, { marginTop: 16 }]}>
              <Text style={[s.section, { marginBottom: 0 }]}>
                {t("shopSettings.autoSku")}
              </Text>
              <Switch
                value={autoSkuEnabled}
                onValueChange={setAutoSkuEnabled}
                trackColor={{ false: C.border, true: C.accent }}
                thumbColor="#fff"
              />
            </View>
            {autoSkuEnabled && (
              <>
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.autoCodePrefix")}
                  value={autoSkuPrefix}
                  onChangeText={(v) =>
                    setAutoSkuPrefix(v.replace(/[^A-Za-z0-9-]/g, ""))
                  }
                  autoCapitalize="characters"
                />
                <Field
                  s={s}
                  C={C}
                  label={t("shopSettings.autoCodeNext")}
                  value={autoSkuNext}
                  onChangeText={setAutoSkuNext}
                  keyboardType="numeric"
                />
                <Text style={s.autoCodePreview}>
                  {`${autoSkuPrefix || "SKU"}-${autoCodeTill || "1"}-${String(Math.max(1, Number(autoSkuNext) || 1)).padStart(5, "0")}`}
                </Text>
              </>
            )}
          </View>

          <TouchableOpacity
            style={s.saveBtn}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={C.accentFg} />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle"
                  size={19}
                  color={C.accentFg}
                />
                <Text style={s.saveBtnText}>{t("common.save")}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

const Field = ({
  s,
  C,
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize,
}: {
  s: Styles;
  C: ThemeColors;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "numeric" | "phone-pad" | "email-address";
  autoCapitalize?: "none" | "characters";
}) => (
  <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput
      style={[s.input, multiline && s.inputMultiline]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
    />
  </View>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (C: ThemeColors, isTablet: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: C.bg,
    },
    scrollOuter: { flexGrow: 1, alignItems: "center" },
    scroll: { padding: 16, gap: 14, paddingBottom: 40, width: "100%" },
    scrollTablet: { maxWidth: 640 },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 4,
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
    title: { fontSize: F.xxl, fontWeight: "700", color: C.text, flex: 1 },

    card: {
      backgroundColor: C.surface,
      borderRadius: R.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      gap: 4,
      ...Shadow.sm,
    },
    section: {
      color: C.muted,
      fontSize: F.xs,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },

    loyaltyHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    loyaltyHint: { color: C.muted, fontSize: F.xs, marginTop: -4 },
    autoCodePreview: {
      color: C.accent,
      fontSize: F.lg,
      fontWeight: "800",
      marginTop: 4,
      marginBottom: 4,
    },

    field: { marginBottom: 12 },
    fieldLabel: { color: C.textSub, fontSize: F.sm, marginBottom: 8 },
    input: {
      backgroundColor: C.card,
      borderRadius: R.md,
      padding: 14,
      color: C.text,
      fontSize: F.md,
      borderWidth: 1,
      borderColor: C.border,
    },
    inputMultiline: { minHeight: 70, textAlignVertical: "top" },

    saveBtn: {
      flexDirection: "row",
      gap: 8,
      backgroundColor: C.accent,
      borderRadius: R.lg,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
      ...Shadow.md,
    },
    saveBtnText: { color: C.accentFg, fontSize: F.lg, fontWeight: "800" },
  });
