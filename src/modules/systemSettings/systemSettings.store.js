const DEFAULT_SETTINGS = {
  platformName: "HotelDesk",
  supportEmail: "support@hoteldesk.com",
  maintenanceMode: false,
  maxBranches: 0,
  defaultLanguage: "English",
  taxRate: 0,
  taxId: "",
  taxOnCommission: false,
  baseCurrency: "INR",
  autoCurrency: false,
};

let settings = { ...DEFAULT_SETTINGS };

const getSystemSettings = () => settings;

const updateSystemSettings = (updates = {}) => {
  settings = { ...settings, ...updates };
  return settings;
};

module.exports = {
  DEFAULT_SETTINGS,
  getSystemSettings,
  updateSystemSettings,
};
