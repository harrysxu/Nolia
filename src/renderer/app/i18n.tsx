import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createTranslator, type Translator } from "../../shared/i18n";
import type { ResolvedLocale } from "../../shared/types";

interface RendererI18nContextValue {
  locale: ResolvedLocale;
  tr: Translator;
}

const fallbackLocale: ResolvedLocale = "zh-CN";
const RendererI18nContext = createContext<RendererI18nContextValue>({
  locale: fallbackLocale,
  tr: createTranslator(fallbackLocale)
});

export function RendererI18nProvider({ locale, children }: { locale: ResolvedLocale; children: ReactNode }) {
  const value = useMemo(
    () => ({
      locale,
      tr: createTranslator(locale)
    }),
    [locale]
  );
  return <RendererI18nContext.Provider value={value}>{children}</RendererI18nContext.Provider>;
}

export function useRendererI18n(): RendererI18nContextValue {
  return useContext(RendererI18nContext);
}
