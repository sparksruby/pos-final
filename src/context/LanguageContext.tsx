import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { translations, Language, TranslationKey } from "../i18n/translations";

const STORAGE_KEY = "pos_language";
const DEFAULT_LANGUAGE: Language = "en";

interface LanguageContextValue {
  lang:    Language;
  setLang: (lang: Language) => void;
  t:       (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [lang, setLangState] = useState<Language>(DEFAULT_LANGUAGE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved === "en" || saved === "my") setLangState(saved);
      setLoaded(true);
    });
  }, []);

  const setLang = (next: Language) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    let str: string = translations[lang][key] ?? translations.en[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  };

  const value = useMemo(() => ({ lang, setLang, t }), [lang]);

  if (!loaded) return null;

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
};
