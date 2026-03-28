const mongoose = require("mongoose");

const NOT_DELETED_FILTER = { isDeleted: { $ne: true } };

const applySoftDeleteBehavior = (schema) => {
  schema.query.withDeleted = function withDeleted() {
    return this.setOptions({ includeDeleted: true });
  };

  const queryMiddleware = [
    "count",
    "countDocuments",
    "find",
    "findOne",
    "findOneAndDelete",
    "findOneAndReplace",
    "findOneAndUpdate",
    "distinct",
  ];

  queryMiddleware.forEach((middleware) => {
    schema.pre(middleware, function enforceNotDeleted() {
      if (!this.getOptions().includeDeleted) {
        this.where(NOT_DELETED_FILTER);
      }
    });
  });

  schema.pre("aggregate", function enforceAggregateNotDeleted() {
    if (!this.options?.includeDeleted) {
      this.pipeline().unshift({ $match: NOT_DELETED_FILTER });
    }
  });
};

const toObjectIdIfValid = (value) =>
  mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;

const buildBranchReferenceMatch = (branchIds = []) => {
  const stringIds = branchIds
    .map((branchId) => branchId?.toString?.() || String(branchId || ""))
    .filter(Boolean);
  const objectIds = stringIds
    .map((branchId) => toObjectIdIfValid(branchId))
    .filter(Boolean);

  if (!stringIds.length) {
    return { $in: [] };
  }

  if (!objectIds.length) {
    return { $in: stringIds };
  }

  return {
    $in: [...objectIds, ...stringIds],
  };
};

const getOrganizationModel = () =>
  require("../modules/organization/organization.model");
const getBranchModel = () => require("../modules/branch/branch.model");

const getActiveOrganizations = async (filter = {}, projection = null) => {
  const Organization = getOrganizationModel();
  const query = Organization.find(filter);

  if (projection) {
    query.select(projection);
  }

  return query.lean();
};

const getActiveBranches = async (filter = {}, projection = null) => {
  const Branch = getBranchModel();
  const query = Branch.find(filter);

  if (projection) {
    query.select(projection);
  }

  return query.lean();
};

const getActiveOrganizationIds = async (filter = {}) => {
  const organizations = await getActiveOrganizations(filter, "organizationId");
  return organizations.map((organization) => organization.organizationId).filter(Boolean);
};

const getActiveBranchIds = async (filter = {}) => {
  const branches = await getActiveBranches(filter, "_id");
  return branches.map((branch) => branch._id).filter(Boolean);
};

const ensureActiveOrganization = async (organizationId) => {
  if (!organizationId) {
    return null;
  }

  const Organization = getOrganizationModel();
  return Organization.findOne({ organizationId });
};

const ensureActiveBranch = async (branchId) => {
  if (!branchId) {
    return null;
  }

  const Branch = getBranchModel();
  return Branch.findById(branchId);
};

const assertUserWorkspaceIsActive = async (user = {}) => {
  if (!user || user.isPlatformAdmin || user.role === "SUPER_ADMIN") {
    return { organization: null, branch: null };
  }

  let organization = null;
  let branch = null;

  if (user.organizationId) {
    organization = await ensureActiveOrganization(user.organizationId);

    if (!organization) {
      const error = new Error("Organization not found");
      error.statusCode = 403;
      throw error;
    }
  }

  if (user.branchId) {
    branch = await ensureActiveBranch(user.branchId);

    if (!branch) {
      const error = new Error("Branch not found");
      error.statusCode = 403;
      throw error;
    }
  }

  return { organization, branch };
};

module.exports = {
  NOT_DELETED_FILTER,
  applySoftDeleteBehavior,
  buildBranchReferenceMatch,
  getActiveOrganizations,
  getActiveBranches,
  getActiveOrganizationIds,
  getActiveBranchIds,
  ensureActiveOrganization,
  ensureActiveBranch,
  assertUserWorkspaceIsActive,
};
