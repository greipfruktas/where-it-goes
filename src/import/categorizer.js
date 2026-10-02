const BUILT_IN_RULES = [
  { category: "Food", words: ["MAXIMA", "IKI", "RIMI", "LIDL", "NORFA", "MARKET", "RESTAURANT", "CAFE", "PIZZA", "BURGER"] },
  { category: "Transport", words: ["BUS", "BOLT", "UBER", "TAXI", "TRAIN", "GELEZINKEL", "CIRCLE K", "VIADA", "NESTE", "FUEL"] },
  { category: "Home", words: ["IKEA", "JYSK", "SENUKAI", "DEPO", "FURNITURE", "HOME"] },
  { category: "Bills", words: ["IGNITIS", "ELECTRIC", "WATER", "INTERNET", "TELE2", "TELIA", "BITE", "INSURANCE", "ERGO"] },
  { category: "Health", words: ["VAISTINE", "PHARMACY", "CLINIC", "DENTAL", "HEALTH"] },
  { category: "Shopping", words: ["ZARA", "H&M", "RESERVED", "CLOTHES", "AMAZON", "PIGU"] },
  { category: "Fun", words: ["CINEMA", "KINAS", "APOLLO", "THEATRE", "CONCERT", "SPOTIFY", "NETFLIX"] }
];

export function normalizeMerchant(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(?:POS|TERMINAL|REF|REFERENCE)\s*[:#-]?\s*[A-Z0-9-]{4,}\s*$/i, "")
    .replace(/[^A-Z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function categorizeTransaction(transaction, categories, learnedRules = []) {
  const merchantKey = normalizeMerchant(transaction?.merchant);
  const available = new Set((categories || []).map(({ name }) => name));
  const learned = learnedRules.find((rule) => rule?.merchantKey === merchantKey);
  if (learned) {
    return { category: available.has(learned.category) ? learned.category : "Other", merchantKey, source: available.has(learned.category) ? "learned" : "other" };
  }
  const haystack = normalizeMerchant(`${transaction?.merchant || ""} ${transaction?.description || ""}`);
  const padded = ` ${haystack} `;
  const builtIn = BUILT_IN_RULES.find((rule) => available.has(rule.category) && rule.words.some((word) => padded.includes(` ${word} `)));
  return { category: builtIn?.category || "Other", merchantKey, source: builtIn ? "built-in" : "other" };
}

export function upsertLearnedRule(rules, merchantKey, category, updatedAt) {
  const next = { merchantKey: String(merchantKey), category: String(category), updatedAt: Number(updatedAt) };
  let replaced = false;
  const result = (rules || []).map((rule) => {
    if (rule.merchantKey !== next.merchantKey) return { ...rule };
    replaced = true;
    return next;
  });
  if (!replaced) result.push(next);
  return result;
}
