const Organization = require("../organization/organization.model");
const Branch = require("../branch/branch.model");
const mongoose = require("mongoose");
const User = require("../user/user.model");
const Booking = require("../booking/booking.model"); // ADD THIS
const Invoice = require("../invoice/invoice.model");
const POSOrder = require("../pos/posOrder.model");
const Room = require("../room/room.model");
const AuditLog = require("../audit/audit.model");

const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const toTitleCase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatTimeAgo = (date) => {
  const timestamp = new Date(date).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} min ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hr ago`;
  return `${Math.floor(diffMs / day)} day ago`;
};

const getActivityType = (action = "") => {
  const normalizedAction = String(action).toUpperCase();

  if (normalizedAction.includes("DELETE") || normalizedAction.includes("CANCEL")) {
    return "danger";
  }

  if (normalizedAction.includes("BLOCK") || normalizedAction.includes("SUSPEND")) {
    return "warning";
  }

  if (
    normalizedAction.includes("CREATE") ||
    normalizedAction.includes("ADD") ||
    normalizedAction.includes("UPDATE") ||
    normalizedAction.includes("EDIT")
  ) {
    return "success";
  }

  return "info";
};

const getGlobalRevenueKpi = async ({ role, organizationId }) => {
  const invoiceMatch = {
    isActive: true,
    status: "PAID",
    referenceType: "BOOKING",
  };

  const posMatch = {
    isActive: true,
    paymentStatus: "PAID",
  };

  if (role === "CORPORATE_ADMIN") {
    invoiceMatch.organizationId = organizationId;
    posMatch.organizationId = organizationId;
  }

  const [roomRevenueAgg, posRevenueAgg] = await Promise.all([
    Invoice.aggregate([
      { $match: invoiceMatch },
      { $group: { _id: null, total: { $sum: "$paidAmount" } } },
    ]),
    POSOrder.aggregate([
      { $match: posMatch },
      { $group: { _id: null, total: { $sum: "$subTotal" } } },
    ]),
  ]);

  const roomRevenue = toNumber(roomRevenueAgg[0]?.total);
  const posRevenue = toNumber(posRevenueAgg[0]?.total);

  return roomRevenue + posRevenue;
};

const getAverageOccupancyKpi = async ({ role, organizationId }) => {
  const branchFilter = {};

  if (role === "CORPORATE_ADMIN") {
    branchFilter.organizationId = organizationId;
  }

  const branches = await Branch.find(branchFilter).select("_id").lean();

  if (!branches.length) {
    return 0;
  }

  const branchIds = branches.map((branch) => branch._id);

  const roomStats = await Room.aggregate([
    {
      $match: {
        isActive: true,
        branchId: { $in: branchIds },
      },
    },
    {
      $group: {
        _id: "$branchId",
        totalRooms: { $sum: 1 },
        occupiedRooms: {
          $sum: {
            $cond: [{ $eq: ["$status", "OCCUPIED"] }, 1, 0],
          },
        },
      },
    },
  ]);

  const roomStatsMap = new Map(
    roomStats.map((item) => [
      item._id.toString(),
      {
        totalRooms: toNumber(item.totalRooms),
        occupiedRooms: toNumber(item.occupiedRooms),
      },
    ]),
  );

  const totalOccupancyAcrossBranches = branches.reduce((sum, branch) => {
    const stats = roomStatsMap.get(branch._id.toString()) || {
      totalRooms: 0,
      occupiedRooms: 0,
    };

    if (stats.totalRooms <= 0) {
      return sum;
    }

    return sum + (stats.occupiedRooms / stats.totalRooms) * 100;
  }, 0);

  const averageOccupancy = totalOccupancyAcrossBranches / branches.length;

  return Number.isFinite(averageOccupancy)
    ? Number(averageOccupancy.toFixed(2))
    : 0;
};

const getRevenueTrendData = async ({ role, organizationId }) => {
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59, 999);

  const invoiceMatch = {
    isActive: true,
    status: "PAID",
    referenceType: "BOOKING",
    createdAt: { $gte: yearStart, $lte: yearEnd },
  };

  const posMatch = {
    isActive: true,
    paymentStatus: "PAID",
    createdAt: { $gte: yearStart, $lte: yearEnd },
  };

  if (role === "CORPORATE_ADMIN") {
    invoiceMatch.organizationId = organizationId;
    posMatch.organizationId = organizationId;
  }

  const [roomRevenueAgg, posRevenueAgg] = await Promise.all([
    Invoice.aggregate([
      { $match: invoiceMatch },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          revenue: { $sum: "$paidAmount" },
        },
      },
    ]),
    POSOrder.aggregate([
      { $match: posMatch },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          revenue: { $sum: "$subTotal" },
        },
      },
    ]),
  ]);

  const revenueByMonth = new Map();

  roomRevenueAgg.forEach((item) => {
    const month = item?._id?.month;
    if (!month) return;
    revenueByMonth.set(month, toNumber(revenueByMonth.get(month)) + toNumber(item.revenue));
  });

  posRevenueAgg.forEach((item) => {
    const month = item?._id?.month;
    if (!month) return;
    revenueByMonth.set(month, toNumber(revenueByMonth.get(month)) + toNumber(item.revenue));
  });

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return months.map((month, index) => ({
    month,
    revenue: toNumber(revenueByMonth.get(index + 1)),
  }));
};

const getRecentActivityFeed = async ({ userId, role, organizationId, limit = 10 }) => {
  if (!userId) {
    return [];
  }

  const filter = { userId };

  if (role === "CORPORATE_ADMIN" && organizationId) {
    filter.organizationId = organizationId;
  }

  const logs = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return logs.map((log, index) => ({
    id: index + 1,
    type: getActivityType(log.action),
    message:
      log.message ||
      `${toTitleCase(log.action)}${log.module ? ` in ${toTitleCase(log.module)}` : ""}`,
    time: formatTimeAgo(log.createdAt),
  }));
};

const getOrganizationRevenueBreakdown = async ({ role, organizationId }) => {
  const organizationFilter = {};

  if (role === "CORPORATE_ADMIN") {
    organizationFilter.organizationId = organizationId;
  }

  const organizations = await Organization.find(organizationFilter)
    .select("organizationId name serviceTier isActive isBlocked")
    .lean();

  if (!organizations.length) {
    return [];
  }

  const organizationIds = organizations.map((org) => org.organizationId);

  const branches = await Branch.find({
    organizationId: { $in: organizationIds },
  })
    .select("_id organizationId name country totalRooms isActive")
    .lean();

  const branchIds = branches.map((branch) => branch._id);
  const branchObjectIds = branchIds.filter(Boolean);
  const branchStringIds = branchIds.map((branchId) => branchId.toString());

  const [roomStats, roomRevenueAgg, posRevenueAgg] = await Promise.all([
    branchObjectIds.length
      ? Room.aggregate([
          {
            $match: {
              isActive: true,
              branchId: { $in: branchObjectIds },
            },
          },
          {
            $group: {
              _id: "$branchId",
              totalRooms: { $sum: 1 },
              occupiedRooms: {
                $sum: {
                  $cond: [{ $eq: ["$status", "OCCUPIED"] }, 1, 0],
                },
              },
            },
          },
        ])
      : [],
    branchObjectIds.length
      ? Invoice.aggregate([
          {
            $match: {
              isActive: true,
              status: "PAID",
              referenceType: "BOOKING",
              branchId: { $in: branchObjectIds },
            },
          },
          {
            $group: {
              _id: "$branchId",
              revenue: { $sum: "$paidAmount" },
            },
          },
        ])
      : [],
    branchStringIds.length
      ? POSOrder.aggregate([
          {
            $match: {
              isActive: true,
              paymentStatus: "PAID",
              branchId: { $in: branchStringIds },
            },
          },
          {
            $group: {
              _id: "$branchId",
              revenue: { $sum: "$subTotal" },
            },
          },
        ])
      : [],
  ]);

  const roomStatsMap = new Map(
    roomStats.map((item) => [
      item._id.toString(),
      {
        totalRooms: toNumber(item.totalRooms),
        occupiedRooms: toNumber(item.occupiedRooms),
      },
    ]),
  );

  const revenueMap = new Map();

  roomRevenueAgg.forEach((item) => {
    const branchKey = item._id?.toString();
    if (!branchKey) return;
    revenueMap.set(branchKey, toNumber(revenueMap.get(branchKey)) + toNumber(item.revenue));
  });

  posRevenueAgg.forEach((item) => {
    const branchKey = item._id?.toString();
    if (!branchKey) return;
    revenueMap.set(branchKey, toNumber(revenueMap.get(branchKey)) + toNumber(item.revenue));
  });

  const branchesByOrganization = new Map();

  branches.forEach((branch) => {
    const branchKey = branch._id.toString();
    const stats = roomStatsMap.get(branchKey) || {
      totalRooms: toNumber(branch.totalRooms),
      occupiedRooms: 0,
    };
    const totalRooms = stats.totalRooms > 0 ? stats.totalRooms : toNumber(branch.totalRooms);
    const occupancy =
      totalRooms > 0 ? Number(((stats.occupiedRooms / totalRooms) * 100).toFixed(2)) : 0;

    const branchData = {
      branchId: branchKey,
      name: branch.name || "Unnamed Branch",
      country: branch.country || "Unknown location",
      totalRooms,
      occupancy,
      revenue: toNumber(revenueMap.get(branchKey)),
    };

    const orgBranches = branchesByOrganization.get(branch.organizationId) || [];
    orgBranches.push(branchData);
    branchesByOrganization.set(branch.organizationId, orgBranches);
  });

  return organizations.map((organization) => {
    const orgBranches = branchesByOrganization.get(organization.organizationId) || [];
    const totalBranches = orgBranches.length;
    const totalRooms = orgBranches.reduce((sum, branch) => sum + toNumber(branch.totalRooms), 0);
    const totalRevenue = orgBranches.reduce((sum, branch) => sum + toNumber(branch.revenue), 0);
    const avgOccupancy =
      totalBranches > 0
        ? Number(
            (
              orgBranches.reduce((sum, branch) => sum + toNumber(branch.occupancy), 0) /
              totalBranches
            ).toFixed(2),
          )
        : 0;

    const sortedBranches = [...orgBranches].sort((a, b) => b.revenue - a.revenue);
    const bestPerformingBranch = sortedBranches[0] || null;
    const lowPerformingBranch =
      sortedBranches.length > 1 ? sortedBranches[sortedBranches.length - 1] : null;

    return {
      organizationId: organization.organizationId,
      name: organization.name || "Unnamed Organization",
      status: organization.isBlocked
        ? "suspended"
        : organization.isActive
          ? "active"
          : "inactive",
      plan: toTitleCase(organization.serviceTier || "starter"),
      totalBranches,
      totalRooms,
      avgOccupancy,
      totalRevenue,
      bestPerformingBranch,
      lowPerformingBranch,
      emptyStateMessage: totalBranches === 0 ? "No active branches" : "",
    };
  });
};

const getDashboardOverview = async (req, res) => {
  try {
    const role = req.user.role;
    const organizationId = req.user.organizationId;
    const branchId = req.user.branchId;

    let totalOrganizations = 0;
    let totalBranches = 0;
    let activeUsers = 0;

    let totalRevenue = 0;
    let monthlyRevenue = 0;
    let quarterlyRevenue = 0;
    let globalRevenue = 0;
    let occupancy = 0;
    let organizationBreakdown = [];
    let revenueData = [];
    let activityFeed = [];

    const now = new Date();

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfQuarter = new Date(now.getFullYear(), now.getMonth() - 3, 1);

    /*
      SUPER ADMIN → Global data
    */
    if (role === "SUPER_ADMIN") {
      totalOrganizations = await Organization.countDocuments();
      totalBranches = await Branch.countDocuments();
      activeUsers = await User.countDocuments({ isActive: true });

      // TOTAL REVENUE
      const totalAgg = await Booking.aggregate([
        { $match: { paymentStatus: "PAID" } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      totalRevenue = totalAgg[0]?.total || 0;

      // MONTHLY
      const monthlyAgg = await Booking.aggregate([
        {
          $match: {
            paymentStatus: "PAID",
            createdAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      monthlyRevenue = monthlyAgg[0]?.total || 0;

      // QUARTERLY
      const quarterlyAgg = await Booking.aggregate([
        {
          $match: {
            paymentStatus: "PAID",
            createdAt: { $gte: startOfQuarter },
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      quarterlyRevenue = quarterlyAgg[0]?.total || 0;
    }

    /*
      CORPORATE ADMIN
    */
    else if (role === "CORPORATE_ADMIN") {
      totalOrganizations = 1;

      totalBranches = await Branch.countDocuments({
        organizationId,
      });

      activeUsers = await User.countDocuments({
        isActive: true,
        organizationId,
      });

      const match = {
        organizationId,
        paymentStatus: "PAID",
      };

      const totalAgg = await Booking.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      totalRevenue = totalAgg[0]?.total || 0;

      const monthlyAgg = await Booking.aggregate([
        { $match: { ...match, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      monthlyRevenue = monthlyAgg[0]?.total || 0;

      const quarterlyAgg = await Booking.aggregate([
        { $match: { ...match, createdAt: { $gte: startOfQuarter } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      quarterlyRevenue = quarterlyAgg[0]?.total || 0;
    }

    /*
      BRANCH MANAGER
    */
    else if (role === "BRANCH_MANAGER") {
      totalOrganizations = 1;
      totalBranches = 1;

      activeUsers = await User.countDocuments({
        isActive: true,
        branchId,
      });

      const match = {
        branchId,
        paymentStatus: "PAID",
      };

      const totalAgg = await Booking.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      totalRevenue = totalAgg[0]?.total || 0;

      const monthlyAgg = await Booking.aggregate([
        { $match: { ...match, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      monthlyRevenue = monthlyAgg[0]?.total || 0;

      const quarterlyAgg = await Booking.aggregate([
        { $match: { ...match, createdAt: { $gte: startOfQuarter } } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      quarterlyRevenue = quarterlyAgg[0]?.total || 0;
    }

    if (role === "SUPER_ADMIN" || role === "CORPORATE_ADMIN") {
      [globalRevenue, occupancy, organizationBreakdown, revenueData, activityFeed] = await Promise.all([
        getGlobalRevenueKpi({ role, organizationId }),
        getAverageOccupancyKpi({ role, organizationId }),
        getOrganizationRevenueBreakdown({ role, organizationId }),
        getRevenueTrendData({ role, organizationId }),
        getRecentActivityFeed({ userId: req.user.id, role, organizationId }),
      ]);
    }

    res.json({
      kpi: {
        totalOrganizations,
        totalBranches,
        activeUsers,
        globalRevenue: toNumber(globalRevenue),
        occupancy: toNumber(occupancy),
        systemHealth: 99.8,
      },

      roomRevenue: {
        total: totalRevenue,
        monthly: monthlyRevenue,
        quarterly: quarterlyRevenue,
      },
      revenueData,
      activityFeed,
      organizationBreakdown,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getDashboardOverview };
