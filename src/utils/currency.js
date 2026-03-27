const currencyConfig = {
  INR: {
    symbol: "₹",
    locale: "en-IN",
  },
};

const DEFAULT_CURRENCY = "INR";

const normalizeCurrency = (currency) => {
  const normalized = String(currency || DEFAULT_CURRENCY).trim().toUpperCase();

  return currencyConfig[normalized] ? normalized : DEFAULT_CURRENCY;
};

const formatAmount = (amount) => {
  const parsed = Number.parseFloat(String(amount ?? 0));

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number.parseFloat(parsed.toFixed(2));
};

const formatCurrency = (amount, currency = DEFAULT_CURRENCY) => {
  const normalizedCurrency = normalizeCurrency(currency);
  const config = currencyConfig[normalizedCurrency];

  return new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(formatAmount(amount));
};

module.exports = {
  currencyConfig,
  DEFAULT_CURRENCY,
  normalizeCurrency,
  formatAmount,
  formatCurrency,
};
