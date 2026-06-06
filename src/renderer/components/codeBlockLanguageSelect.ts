import { CODE_BLOCK_LANGUAGE_OPTIONS, normalizeCodeBlockLanguage } from "../../shared/codeBlockLanguages";
import type { Translator } from "../../shared/i18n";

export function getCodeBlockLanguageSelectOptions(currentLanguage: unknown, tr: Translator): Array<{ value: string; label: string }> {
  const current = normalizeCodeBlockLanguage(currentLanguage);
  const options = CODE_BLOCK_LANGUAGE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.value === "text" ? tr("纯文本") : option.label
  }));
  if (options.some((option) => option.value === current)) {
    return options;
  }
  return [{ value: current, label: current }, ...options];
}
