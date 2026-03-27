const branchService = require("./branch.service");
const Branch = require("./branch.model");
const Organization = require("../organization/organization.model");
const mongoose = require("mongoose");
const branchSettingsService = require("../branchSettings/branchSettings.service");

/*
  Create Branch
*/
exports.createBranch = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        message: "Unauthorized. User not found",
      });
    }

    const branch = await branchService.createBranch(req.body, req.user);

    res.status(201).json({
      message: "Branch created successfully",
      data: branch,
    });
  } catch (error) {
    console.error("CREATE BRANCH ERROR:", error);

    res.status(400).json({
      message: error.message || "Failed to create branch",
    });
  }
};

/*
  Get Branches
*/
exports.getBranches = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const mongoose = require("mongoose");
    const role = req.user.role?.toUpperCase();

    let branches = [];
    let organizations = [];

    /*
      SUPER ADMIN → All branches
    */
    if (role === "SUPER_ADMIN") {
      branches = await Branch.find().lean();
      organizations = await Organization.find().lean();
    }

    /*
      CORPORATE ADMIN → Organization branches
    */
    else if (role === "CORPORATE_ADMIN") {
      const orgId = req.user.organizationId;

      branches = await Branch.find({
        organizationId: orgId,
      }).lean();

      organizations = await Organization.find({
        $or: [
          { organizationId: orgId },
          ...(mongoose.Types.ObjectId.isValid(orgId)
            ? [{ _id: new mongoose.Types.ObjectId(orgId) }]
            : []),
        ],
      }).lean();
    }

    /*
      BRANCH USERS (Manager + Staff)
    */
    else if (req.user.branchId) {
      branches = await Branch.find({
        _id: req.user.branchId,
      }).lean();

      organizations = await Organization.find().lean();
    }

    else {
      return res.status(403).json({
        message: "Insufficient permission",
      });
    }

    /*
      Attach organizationName
    */
    const orgMap = new Map(
      organizations.flatMap((org) => [
        [String(org._id), org.name],
        [String(org.organizationId), org.name],
      ])
    );

    const enriched = branches.map((branch) => {
      const branchOrgId =
        branch.organizationId && branch.organizationId._id
          ? String(branch.organizationId._id)
          : String(branch.organizationId);

      const organizationName = orgMap.get(branchOrgId) || "N/A";

      return {
        ...branch,
        organizationName,
        organization: {
          name: organizationName,
        },
      };
    });

    res.status(200).json({
      count: enriched.length,
      data: enriched,
    });
  } catch (error) {
    console.error("GET BRANCHES ERROR:", error);

    res.status(500).json({
      message: error.message || "Failed to fetch branches",
    });
  }
};

/*
  Update Branch
*/
exports.updateBranch = async (req, res) => {
  try {
    const { branchId } = req.params;

    const updatedBranch = await branchService.updateBranch(
      branchId,
      req.body,
      req.user,
    );

    res.status(200).json({
      message: "Branch updated successfully",
      data: updatedBranch,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Deactivate Branch
*/
exports.deactivateBranch = async (req, res) => {
  try {
    const { branchId } = req.params;

    const branch = await branchService.deactivateBranch(branchId, req.user);

    res.status(200).json({
      message: "Branch deactivated successfully",
      data: branch,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Invite Branch Manager
*/
exports.inviteBranchManager = async (req, res) => {
  try {
    const result = await branchService.inviteBranchManager(req.body, req.user);

    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Delete Branch
*/
exports.deleteBranch = async (req, res) => {
  try {
    const { branchId } = req.params;

    const deletedBranch = await branchService.deleteBranch(branchId, req.user);

    res.status(200).json({
      message: "Branch deleted successfully",
      data: deletedBranch,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Get Single Branch By ID
*/
exports.getBranchById = async (req, res) => {
  try {
    const { branchId } = req.params;

    const branch = await branchService.getBranchById(branchId, req.user);
    const financialSettings =
      await branchSettingsService.getFinancialSettingsByBranchId(branch._id);

    res.status(200).json({
      data: {
        ...branch.toObject(),
        financialSettings,
      },
    });
  } catch (error) {
    res.status(404).json({
      message: error.message,
    });
  }
};
