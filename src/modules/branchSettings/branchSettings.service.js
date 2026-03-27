const BranchSettings = require("./branchSettings.model");
const Branch = require("../branch/branch.model");

/*
  Permission Helper
*/
const requirePermission = (user, permission) => {
  if (user.isPlatformAdmin) return;

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

/*
  Create Default Settings (Auto on branch creation)
*/
exports.createDefaultSettings = async (organizationId, branchId, userId) => {

  const existing = await BranchSettings.findOne({ branchId });

  if (existing) return existing;

  const settings = await BranchSettings.create({
    organizationId,
    branchId,
    updatedBy: userId,
  });

  return settings;
};

/*
  Internal Helper: Financial Settings By Branch
*/
exports.getFinancialSettingsByBranchId = async (branchId) => {
  if (!branchId) {
    return {
      taxPercentage: 0,
      serviceChargePercentage: 0,
    };
  }

  const normalizedBranchId = String(branchId);

  let settings = await BranchSettings.findOne({ branchId: normalizedBranchId })
    .select("financial organizationId branchId")
    .lean();

  if (!settings) {
    const branch = await Branch.findById(normalizedBranchId)
      .select("organizationId")
      .lean();

    if (!branch) {
      return {
        taxPercentage: 0,
        serviceChargePercentage: 0,
      };
    }

    settings = await BranchSettings.create({
      organizationId: branch.organizationId,
      branchId: normalizedBranchId,
    });
  }

  return {
    taxPercentage: Number(settings.financial?.defaultTaxPercentage || 0),
    serviceChargePercentage: Number(
      settings.financial?.serviceChargePercentage || 0,
    ),
  };
};


/*
  Get Branch Settings
*/
exports.getSettings = async (branchId, user) => {

  requirePermission(user, "ACCESS_BRANCH_SETTINGS");

  let settings = await BranchSettings.findOne({ branchId });

  if (!settings) {

    const branch = await Branch.findById(branchId);

    if (!branch) {
      const error = new Error("Branch not found");
      error.statusCode = 404;
      throw error;
    }

    settings = await BranchSettings.create({
      organizationId: branch.organizationId,
      branchId,
      updatedBy: user.userId || user.id,
    });
  }

  return settings;
};


/*
  Update Full Settings
*/
exports.updateSettings = async (branchId, data, user) => {

  requirePermission(user, "ACCESS_BRANCH_SETTINGS");

  const settings = await BranchSettings.findOne({ branchId });

  if (!settings) {
    const error = new Error("Branch settings not found");
    error.statusCode = 404;
    throw error;
  }

  Object.assign(settings, data);
  settings.updatedBy = user.userId;

  await settings.save();

  return settings;
};


/*
  Partial Update (Section-Based)
  Example: update only financial or bookingPolicy
*/
exports.updateSection = async (branchId, sectionKey, data, user) => {

  requirePermission(user, "ACCESS_BRANCH_SETTINGS");

  const settings = await BranchSettings.findOne({ branchId });

  if (!settings) {
    const error = new Error("Branch settings not found");
    error.statusCode = 404;
    throw error;
  }

  if (!settings[sectionKey]) {
    const error = new Error("Invalid settings section");
    error.statusCode = 400;
    throw error;
  }

  settings[sectionKey] = {
    ...settings[sectionKey],
    ...data,
  };

  settings.updatedBy = user.userId;

  await settings.save();

  return settings;
};


/*
  Reset Settings To Default
*/
exports.resetSettings = async (branchId, user) => {

  requirePermission(user, "ACCESS_BRANCH_SETTINGS");

  const settings = await BranchSettings.findOne({ branchId });

  if (!settings) {
    const error = new Error("Branch settings not found");
    error.statusCode = 404;
    throw error;
  }

  await BranchSettings.deleteOne({ branchId });

  const newSettings = await BranchSettings.create({
    organizationId: user.organizationId,
    branchId,
    updatedBy: user.userId,
  });

  return newSettings;
};
