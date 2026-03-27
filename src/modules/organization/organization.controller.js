const organizationService = require("./organization.service");
const Organization = require("./organization.model");
const Branch = require("../branch/branch.model");
const User = require("../user/user.model");
const RefreshToken = require("../auth/refreshToken.model");
const Invoice = require("../invoice/invoice.model");
const POSOrder = require("../pos/posOrder.model");

/*
  Create Organization
  SUPER_ADMIN only
*/
exports.createOrganization = async (req, res) => {
  try {
    console.log("Controller Hit");
    console.log(req.body);
    console.log("REQ USER:", req.user);
    console.log("SUPER ADMIN ID:", req.user?._id);
    console.log("Corporate Admin Data:", req.body.corporateAdmin);

    const organization = await organizationService.createOrganization(
      req.body,
      req.user.id,
    );

    res.status(201).json({
      message: "Organization created successfully",
      data: organization,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Get All Organizations
  SUPER_ADMIN only
*/
exports.getAllOrganizations = async (req, res) => {
  try {
    let organizations;

    if (req.user.role === "SUPER_ADMIN") {
      organizations = await Organization.find();
    } else if (req.user.role === "CORPORATE_ADMIN") {
      organizations = await Organization.find({
        organizationId: req.user.organizationId,
      });
    } else if (req.user.role === "BRANCH_MANAGER") {
      const branch = await Branch.findById(req.user.branchId);

      if (!branch) {
        return res.status(404).json({
          message: "Branch not found",
        });
      }

      organizations = await Organization.find({
        organizationId: branch.organizationId,
      });
    } else {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const organizationIds = organizations.map((org) => org.organizationId);

    const [roomRevenueAgg, posRevenueAgg] = await Promise.all([
      organizationIds.length
        ? Invoice.aggregate([
            {
              $match: {
                isActive: true,
                status: "PAID",
                referenceType: "BOOKING",
                organizationId: { $in: organizationIds },
              },
            },
            {
              $group: {
                _id: "$organizationId",
                revenue: { $sum: "$paidAmount" },
              },
            },
          ])
        : [],
      organizationIds.length
        ? POSOrder.aggregate([
            {
              $match: {
                isActive: true,
                paymentStatus: "PAID",
                organizationId: { $in: organizationIds },
              },
            },
            {
              $group: {
                _id: "$organizationId",
                revenue: { $sum: "$subTotal" },
              },
            },
          ])
        : [],
    ]);

    const revenueByOrganization = new Map();

    roomRevenueAgg.forEach((item) => {
      const organizationKey = item._id;
      if (!organizationKey) return;
      revenueByOrganization.set(
        organizationKey,
        (revenueByOrganization.get(organizationKey) || 0) + (item.revenue || 0),
      );
    });

    posRevenueAgg.forEach((item) => {
      const organizationKey = item._id;
      if (!organizationKey) return;
      revenueByOrganization.set(
        organizationKey,
        (revenueByOrganization.get(organizationKey) || 0) + (item.revenue || 0),
      );
    });

    const enrichedOrganizations = await Promise.all(
      organizations.map(async (org) => {
        const branchesCount = await Branch.countDocuments({
          organizationId: org.organizationId,
        });

        const usersCount = await User.countDocuments({
          organizationId: org.organizationId,
        });

        const corporateAdmin = await User.findOne({
          organizationId: org.organizationId,
          role: "CORPORATE_ADMIN",
        }).select("name");

        return {
          _id: org._id,
          organizationId: org.organizationId,
          name: org.name,
          admins: corporateAdmin ? [corporateAdmin.name] : [],
          branches: branchesCount,
          users: usersCount,
          status: org.isBlocked ? "suspended" : "active",
          revenue: revenueByOrganization.get(org.organizationId) || 0,
          isBlocked: org.isBlocked,
        };
      }),
    );

    res.status(200).json({
      count: enrichedOrganizations.length,
      data: enrichedOrganizations,
    });
  } catch (error) {
    console.error("GET ALL ORG ERROR:", error);

    res.status(500).json({
      message: "Failed to fetch organizations",
    });
  }
};

/*
  Get Organization By ID
*/
exports.getOrganizationById = async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id);

    if (!organization) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    const organizationId = organization.organizationId;

    const [branchesCount, corporateAdmin, roomRevenueAgg, posRevenueAgg] =
      await Promise.all([
        Branch.countDocuments({
          organizationId,
        }),
        User.findOne({
          organizationId,
          role: "CORPORATE_ADMIN",
        }).select("name"),
        Invoice.aggregate([
          {
            $match: {
              isActive: true,
              status: "PAID",
              referenceType: "BOOKING",
              organizationId,
            },
          },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$paidAmount" },
            },
          },
        ]),
        POSOrder.aggregate([
          {
            $match: {
              isActive: true,
              paymentStatus: "PAID",
              organizationId,
            },
          },
          {
            $group: {
              _id: null,
              revenue: { $sum: "$subTotal" },
            },
          },
        ]),
      ]);

    const totalRevenue =
      (roomRevenueAgg[0]?.revenue || 0) + (posRevenueAgg[0]?.revenue || 0);

    res.status(200).json({
      data: {
        ...organization.toObject(),
        admins: corporateAdmin ? [corporateAdmin.name] : [],
        branches: branchesCount || 0,
        revenue: totalRevenue || 0,
        status: organization.isBlocked ? "suspended" : "active",
      },
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch organization",
    });
  }
};

/*
  Update Organization
*/
exports.updateOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!organization) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    res.status(200).json({
      message: "Organization updated successfully",
      data: organization,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Delete Organization
*/
exports.deleteOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id);

    if (!organization) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    const orgId = organization.organizationId;

    const users = await User.find({
      organizationId: orgId,
    });

    const userIds = users.map((u) => u._id);

    await RefreshToken.deleteMany({
      userId: { $in: userIds },
    });

    await User.deleteMany({
      organizationId: orgId,
    });

    await Branch.deleteMany({
      organizationId: orgId,
    });

    await Organization.findByIdAndDelete(id);

    res.status(200).json({
      message: "Organization and all related data deleted successfully",
    });
  } catch (error) {
    console.error("DELETE ORG ERROR:", error);

    res.status(500).json({
      message: "Failed to delete organization",
    });
  }
};

/*
  Deactivate Organization
  SUPER_ADMIN only
*/
exports.deactivateOrganization = async (req, res) => {
  try {
    const { organizationId } = req.params;

    const organization =
      await organizationService.deactivateOrganization(organizationId);

    res.status(200).json({
      message: "Organization deactivated successfully",
      data: organization,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

/*
  Get My Organization (Corporate Admin)
*/
exports.getMyOrganization = async (req, res) => {
  try {
    const organization = await Organization.findOne({
      organizationId: req.user.organizationId,
    });

    if (!organization) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    res.status(200).json({
      data: organization,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch organization",
    });
  }
};

/*
  Block Organization
  SUPER_ADMIN only
*/
exports.blockOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id);

    if (!organization) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    if (organization.isBlocked) {
      return res.status(400).json({
        message: "Organization is already blocked",
      });
    }

    const updated = await Organization.findByIdAndUpdate(
      id,
      {
        isBlocked: true,
        blockedAt: new Date(),
        blockedBy: req.user.id,
      },
      { new: true },
    );

    const users = await User.find({
      organizationId: updated._id,
    });

    const userIds = users.map((u) => u._id);

    await RefreshToken.deleteMany({
      userId: { $in: userIds },
    });

    return res.status(200).json({
      message: "Organization blocked and all users logged out successfully",
      data: updated,
    });
  } catch (error) {
    console.error("BLOCK ERROR:", error);
    return res.status(500).json({
      message: "Failed to block organization",
    });
  }
};

/*
  Unblock Organization
  SUPER_ADMIN only
*/
exports.unblockOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id);

    if (!organization) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    if (!organization.isBlocked) {
      return res.status(400).json({
        message: "Organization is not blocked",
      });
    }

    const updated = await Organization.findByIdAndUpdate(
      id,
      {
        isBlocked: false,
        blockedAt: null,
        blockedBy: null,
      },
      { new: true },
    );

    return res.status(200).json({
      message: "Organization unblocked successfully",
      data: updated,
    });
  } catch (error) {
    console.error("UNBLOCK ERROR:", error);
    return res.status(500).json({
      message: "Failed to unblock organization",
    });
  }
};
