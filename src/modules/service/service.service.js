const Service = require("./service.model");
const Branch = require("../branch/branch.model");

const requirePermission = (user, permission) => {
  if (user.isPlatformAdmin) return;

  if (
    user.role === "SUPER_ADMIN" ||
    user.role === "CORPORATE_ADMIN" ||
    user.role === "BRANCH_MANAGER"
  ) {
    return;
  }

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

const normalizeText = (value, fallback = "") => String(value || fallback).trim();

const parseServiceName = (rawName) => {
  const normalized = normalizeText(rawName);
  if (!normalized) {
    return { category: "Custom", name: "" };
  }

  const separators = [" — ", " - ", "-", "—"];
  for (const separator of separators) {
    if (normalized.includes(separator)) {
      const [left, ...rest] = normalized.split(separator);
      const category = normalizeText(left, "Custom");
      const name = normalizeText(rest.join(separator));
      if (name) {
        return { category, name };
      }
    }
  }

  return { category: "Custom", name: normalized };
};

exports.createService = async (data, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  if (!user.branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  const branch = await Branch.findById(user.branchId);
  if (!branch) {
    const error = new Error("Branch not found");
    error.statusCode = 404;
    throw error;
  }

  const parsed = parseServiceName(data.name);
  const category = normalizeText(data.category, parsed.category || "Custom");
  const name = normalizeText(parsed.name || data.name);
  const price = Number(data.price || 0);

  if (!name) {
    const error = new Error("Service name is required");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isFinite(price) || price < 0) {
    const error = new Error("Service price must be a valid number");
    error.statusCode = 400;
    throw error;
  }

  const existing = await Service.findOne({
    branchId: branch._id,
    category,
    name,
  });

  if (existing) {
    existing.price = price;
    existing.isActive = true;
    existing.updatedBy = user.id || user.userId || user._id;
    await existing.save();
    return existing;
  }

  return Service.create({
    organizationId: branch.organizationId,
    branchId: branch._id,
    category,
    name,
    price,
    createdBy: user.id || user.userId || user._id,
    updatedBy: user.id || user.userId || user._id,
  });
};

exports.getServices = async (user, branchId) => {
  requirePermission(user, "UPDATE_BOOKING");

  const activeBranchId = branchId || user.branchId;
  if (!activeBranchId) {
    const error = new Error("Branch ID is required");
    error.statusCode = 400;
    throw error;
  }

  if (user.branchId && String(activeBranchId) !== String(user.branchId)) {
    const error = new Error("Access denied for selected branch");
    error.statusCode = 403;
    throw error;
  }

  return Service.find({
    branchId: activeBranchId,
    isActive: true,
  }).sort({ category: 1, name: 1, createdAt: -1 });
};

exports.deleteService = async (serviceId, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const service = await Service.findById(serviceId);
  if (!service || !service.isActive) {
    const error = new Error("Service not found");
    error.statusCode = 404;
    throw error;
  }

  if (!user.branchId || String(service.branchId) !== String(user.branchId)) {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  service.isActive = false;
  service.updatedBy = user.id || user.userId || user._id;
  await service.save();

  return service;
};
