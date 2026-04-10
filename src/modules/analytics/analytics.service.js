const mongoose = require("mongoose");
const Room = require("../room/room.model");
const Booking = require("../booking/booking.model");
const Invoice = require("../invoice/invoice.model");
const Branch = require("../branch/branch.model");
const POSOrder = require("../pos/posOrder.model");
const Organization = require("../organization/organization.model");
const {
  buildBranchReferenceMatch,
  ensureActiveBranch,
  getActiveBranchIds,
  getActiveOrganizationIds,
} = require("../../utils/workspaceScope");

const getScopedBranchIdsForUser = async (user, branchId = null) => {
  if (branchId) {
    const branch = await ensureActiveBranch(branchId);
    return branch ? [branch._id] : [];
  }

  if (user.role === "BRANCH_MANAGER") {
    const branch = await ensureActiveBranch(user.branchId);
    return branch ? [branch._id] : [];
  }

  if (user.role === "CORPORATE_ADMIN") {
    return getActiveBranchIds({ organizationId: user.organizationId });
  }

  return getActiveBranchIds();
};

/*
  Role-Based Filter Builder
*/
const getRoleFilter = (user, modelType = "general") => {
  const filter = {};

  /*
    SUPER ADMIN → No restrictions
  */
  if (user.role === "SUPER_ADMIN") {
    // full access
  } else if (user.role === "CORPORATE_ADMIN") {
    /*
    CORPORATE ADMIN → Only their organization
  */
    filter.organizationId = user.organizationId;
  } else if (user.role === "BRANCH_MANAGER") {
    /*
    BRANCH MANAGER → Only their branch
  */
    filter.branchId = user.branchId;
  }

  /*
    Model Specific Filters
  */
  if (modelType === "room") {
    filter.isActive = true;
  }

  if (modelType === "invoice") {
    filter.isActive = true;
  }

  return filter;
};

/*
  1️⃣ Occupancy Rate
*/
exports.getOccupancyRate = async (user) => {
  const roomFilter = getRoleFilter(user, "room");
  const bookingFilter = getRoleFilter(user);

  const totalRooms = await Room.countDocuments(roomFilter);

  const occupiedRooms = await Booking.countDocuments({
    ...bookingFilter,
    status: "CHECKED_IN",
  });

  const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

  return {
    totalRooms,
    occupiedRooms,
    occupancyRate: Number(occupancyRate.toFixed(2)),
  };
};

/*
  2️⃣ ADR (Average Daily Rate)
  ADR = Total Room Revenue / Total Room Nights Sold
*/
exports.getADR = async (user) => {
  const filter = getRoleFilter(user);

  const result = await Booking.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totalAmount" },
        totalNights: { $sum: "$nights" },
      },
    },
  ]);

  if (!result.length || result[0].totalNights === 0) {
    return { ADR: 0 };
  }

  const ADR = result[0].totalRevenue / result[0].totalNights;

  return { ADR: Number(ADR.toFixed(2)) };
};

/*
  3️⃣ RevPAR (Revenue Per Available Room)
  RevPAR = Total Paid Revenue / Total Available Rooms
*/
exports.getRevPAR = async (user) => {
  const roomFilter = getRoleFilter(user, "room");
  const invoiceFilter = {
    ...getRoleFilter(user, "invoice"),
    referenceType: "BOOKING",
  };

  const totalRooms = await Room.countDocuments(roomFilter);

  const revenueAgg = await Invoice.aggregate([
    { $match: invoiceFilter },
    {
      $group: {
        _id: null,
        totalPaid: { $sum: "$paidAmount" },
      },
    },
  ]);

  const totalRevenue = revenueAgg[0]?.totalPaid || 0;

  const revpar = totalRooms > 0 ? totalRevenue / totalRooms : 0;

  return { RevPAR: Number(revpar.toFixed(2)) };
};

/*
  4️⃣ Financial Overview
*/
exports.getFinancialOverview = async (user) => {
  const filter = {
    ...getRoleFilter(user, "invoice"),
    referenceType: "BOOKING",
  };

  const revenueAgg = await Invoice.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$paidAmount" },
        totalOutstanding: { $sum: "$dueAmount" },
      },
    },
  ]);

  return {
    totalRevenue: revenueAgg[0]?.totalRevenue || 0,
    totalOutstanding: revenueAgg[0]?.totalOutstanding || 0,
  };
};

/*
  5️⃣ Corporate Consolidated Dashboard
*/

exports.getCorporateDashboard = async (user) => {
  try {
    if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
      const error = new Error("Access denied");
      error.statusCode = 403;
      throw error;
    }

    const activeOrganizationIds =
      user.role === "CORPORATE_ADMIN"
        ? await getActiveOrganizationIds({ organizationId: user.organizationId })
        : await getActiveOrganizationIds();
    const activeBranchIds = await getScopedBranchIdsForUser(user);
    const activeBranchMatch = buildBranchReferenceMatch(activeBranchIds);

    if (!activeOrganizationIds.length || !activeBranchIds.length) {
      return {
        totalRevenue: 0,
        totalOutstanding: 0,
        branches: [],
        bestBranch: null,
        worstBranch: null,
        bestPerforming: null,
        lowestPerforming: null
      };
    }

    /*
      1. ROOM REVENUE (INVOICE)
    */
    const roomRevenue = await Invoice.aggregate([
      {
        $match: {
          isActive: true,
          status: "PAID",
          referenceType: "BOOKING",
          organizationId: { $in: activeOrganizationIds },
          branchId: activeBranchMatch,
        }
      },
      {
        $group: {
          _id: {
            organizationId: "$organizationId",
            branchId: "$branchId"
          },
          revenue: { $sum: "$paidAmount" },
          outstanding: { $sum: "$dueAmount" }
        }
      }
    ]);

    /*
      2. POS REVENUE
    */
    const posRevenue = await POSOrder.aggregate([
      {
        $match: {
          isActive: true,
          paymentStatus: "PAID",
          organizationId: { $in: activeOrganizationIds },
          branchId: activeBranchMatch,
        }
      },
      {
        $group: {
          _id: {
            organizationId: "$organizationId",
            branchId: "$branchId"
          },
          revenue: { $sum: "$subTotal" }
        }
      }
    ]);

    /*
      3. MERGE BOTH (CRITICAL)
    */
    const revenueMap = {};

    [...roomRevenue, ...posRevenue].forEach(item => {
      const orgId = item?._id?.organizationId;
      const branchId = item?._id?.branchId?.toString();

      if (!orgId || !branchId) return;

      if (!revenueMap[orgId]) {
        revenueMap[orgId] = {};
      }

      if (!revenueMap[orgId][branchId]) {
        revenueMap[orgId][branchId] = { revenue: 0, outstanding: 0 };
      }

      revenueMap[orgId][branchId].revenue += (item.revenue || 0);
      revenueMap[orgId][branchId].outstanding += (item.outstanding || 0);
    });

    /*
      4. CALCULATE ORGANIZATION TOTAL
    */
    const orgTotals = [];
    for (const orgId in revenueMap) {
      const branchesAtOrg = revenueMap[orgId];
      const totalRev = Object.values(branchesAtOrg).reduce((sum, b) => sum + b.revenue, 0);
      const totalOut = Object.values(branchesAtOrg).reduce((sum, b) => sum + b.outstanding, 0);

      orgTotals.push({
        organizationId: orgId,
        revenue: totalRev,
        outstanding: totalOut
      });
    }

    /*
      5. FIND BEST & LOWEST ORGANIZATION (SUPER ADMIN ONLY)
    */
    let bestPerforming = null;
    let lowestPerforming = null;

    if (user.role === "SUPER_ADMIN" && orgTotals.length > 0) {
      orgTotals.sort((a, b) => b.revenue - a.revenue);

      const bestOrg = orgTotals[0];
      const lowestOrg = orgTotals[orgTotals.length - 1];

      const organizations = await Organization.find({
        organizationId: { $in: orgTotals.map((o) => o.organizationId) }
      });

      const bestData = organizations.find(o => o.organizationId === bestOrg.organizationId);
      const lowestData = organizations.find(o => o.organizationId === lowestOrg.organizationId);

      if (bestData) {
        bestPerforming = {
          name: bestData.name,
          revenue: bestOrg.revenue
        };
      }

      if (lowestData) {
        lowestPerforming = {
          name: lowestData.name,
          revenue: lowestOrg.revenue
        };
      }
    }

    /*
      6. PREPARE BRANCHES LIST (Recalculate logic for dashboard)
    */
    const branchesRaw = await Branch.find({
      _id: { $in: activeBranchIds },
      isActive: true,
    }).select("_id name totalRooms");
    
    const branches = branchesRaw.map(b => {
      let bRevenue = 0;
      let bOutstanding = 0;

      // Find in revenueMap
      for (const oId in revenueMap) {
        if (revenueMap[oId][b._id.toString()]) {
          bRevenue = revenueMap[oId][b._id.toString()].revenue;
          bOutstanding = revenueMap[oId][b._id.toString()].outstanding;
          break;
        }
      }

      const revpar = b.totalRooms > 0 ? bRevenue / b.totalRooms : 0;

      return {
        branchId: b._id,
        name: b.name,
        totalRevenue: bRevenue,
        totalOutstanding: bOutstanding,
        totalRooms: b.totalRooms,
        revpar: Number(revpar.toFixed(2))
      };
    });

    branches.sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalRevenue = branches.reduce((sum, b) => sum + b.totalRevenue, 0);
    const totalOutstanding = branches.reduce((sum, b) => sum + b.totalOutstanding, 0);

    return {
      totalRevenue,
      totalOutstanding,
      branches,
      bestBranch: branches[0] || null,
      worstBranch: branches[branches.length - 1] || null,
      bestPerforming,
      lowestPerforming
    };
  } catch (error) {
    console.error("Corporate Dashboard Error:", error);
    return {
      totalRevenue: 0,
      totalOutstanding: 0,
      branches: [],
      bestBranch: null,
      worstBranch: null,
      bestPerforming: null,
      lowestPerforming: null
    };
  }
};

// Branch Dashboard
async function getAvailableRevenueYears(branchId) {
  const branchObjectId = new mongoose.Types.ObjectId(branchId);
  return await Invoice.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        isActive: true,
        referenceType: "BOOKING",
      },
    },
    {
      $group: {
        _id: { $year: "$createdAt" },
      },
    },
    {
      $project: {
        year: "$_id",
        _id: 0,
      },
    },
    { $sort: { year: -1 } },
  ]);
}

exports.getBranchDashboard = async (user, branchId) => {
  if (!branchId) {
    const error = new Error("Branch context required");
    error.statusCode = 400;
    throw error;
  }

  /*
    SECURITY: Branch Manager can only access their own branch
  */
  if (user.role === "BRANCH_MANAGER" && user.branchId !== branchId) {
    const error = new Error("Access denied to this branch");
    error.statusCode = 403;
    throw error;
  }

  const activeBranch = await ensureActiveBranch(branchId);

  if (!activeBranch) {
    const error = new Error("Branch not found");
    error.statusCode = 404;
    throw error;
  }

  const branchObjectId = new mongoose.Types.ObjectId(activeBranch._id);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const quarterStart = new Date();
  const currentMonth = quarterStart.getMonth();
  const quarterMonthStart = currentMonth - (currentMonth % 3);
  quarterStart.setMonth(quarterMonthStart, 1);
  quarterStart.setHours(0, 0, 0, 0);

  /*
    1️⃣ Today Revenue
  */
  const result = await Invoice.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        createdAt: { $gte: todayStart, $lte: todayEnd },
        isActive: true,
        referenceType: "BOOKING",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$paidAmount" },
      },
    },
  ]);

  const todayRevenue = result[0]?.total || 0;

  /*
  ROOM REVENUE (Only Room Invoices)
*/

  const totalRevenueAgg = await Invoice.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        isActive: true,
        referenceType: "BOOKING", // ensures only room bookings
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$paidAmount" },
      },
    },
  ]);

  const totalRevenue = totalRevenueAgg[0]?.total || 0;

  /*
  MONTH ROOM REVENUE
*/

  const monthRevenueAgg = await Invoice.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        createdAt: { $gte: monthStart, $lte: new Date() },
        isActive: true,
        referenceType: "BOOKING",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$paidAmount" },
      },
    },
  ]);

  const monthRevenue = monthRevenueAgg[0]?.total || 0;

  /*
  QUARTER ROOM REVENUE
*/

  const quarterlyRevenueAgg = await Invoice.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        createdAt: { $gte: quarterStart },
        isActive: true,
        referenceType: "BOOKING",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$paidAmount" },
      },
    },
  ]);

  const quarterlyRevenue = quarterlyRevenueAgg[0]?.total || 0;

  /*
    POS Revenue
  */
  const posTotalAgg = await POSOrder.aggregate([
    {
      $match: {
        branchId: branchId,
        paymentStatus: "PAID",
        isActive: true,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$grandTotal" },
      },
    },
  ]);
  const totalPosRevenue = posTotalAgg[0]?.total || 0;

  /*
    Today POS Revenue (NEW)
  */
  const posTodayAgg = await POSOrder.aggregate([
    {
      $match: {
        branchId: branchId,
        createdAt: { $gte: todayStart, $lte: todayEnd },
        paymentStatus: "PAID",
        isActive: true,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$grandTotal" },
      },
    },
  ]);
  const posTodayRevenue = posTodayAgg[0]?.total || 0;

  const posMonthAgg = await POSOrder.aggregate([
    {
      $match: {
        branchId: branchId,
        createdAt: { $gte: monthStart, $lte: todayEnd },
        paymentStatus: "PAID",
        isActive: true,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$grandTotal" },
      },
    },
  ]);
  const posMonthRevenue = posMonthAgg[0]?.total || 0;

  /*
    3️⃣ Outstanding
  */
  const outstandingAgg = await Invoice.aggregate([
    {
      $match: {
        branchId: branchObjectId,
        isActive: true,
        referenceType: "BOOKING",
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$dueAmount" },
      },
    },
  ]);

  const outstandingAmount = outstandingAgg[0]?.total || 0;

  /*
    4️⃣ Room Stats
  */
  const totalRooms = await Room.countDocuments({
    branchId: branchObjectId,
    isActive: true,
  });

  const occupiedRooms = await Room.countDocuments({
    branchId: branchObjectId,
    status: "OCCUPIED",
  });

  const maintenanceRooms = await Room.countDocuments({
    branchId: branchObjectId,
    status: "MAINTENANCE",
  });

  const blockedRooms = await Room.countDocuments({
    branchId: branchObjectId,
    status: "BLOCKED",
  });

  const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

  const revpar = totalRooms > 0 ? monthRevenue / totalRooms : 0;

  /*
    5️⃣ Booking Stats
  */
  const activeBookings = await Booking.countDocuments({
    branchId: branchObjectId,
    status: { $in: ["BOOKED", "CONFIRMED", "CHECKED_IN"] },
  });

  const todayCheckIns = await Booking.countDocuments({
    branchId: branchObjectId,
    checkInDate: { $gte: todayStart, $lte: todayEnd },
  });

  const todayCheckOuts = await Booking.countDocuments({
    branchId: branchObjectId,
    checkOutDate: { $gte: todayStart, $lte: todayEnd },
  });

  return {
    totalRevenue,
    todayRevenue,
    quarterlyRevenue,
    monthRevenue,
    totalPosRevenue,
    posTodayRevenue,
    posMonthRevenue,
    outstandingAmount,
    totalRooms,
    occupiedRooms,
    occupancyRate: Number(occupancyRate.toFixed(2)),
    revpar: Number(revpar.toFixed(2)),
    activeBookings,
    todayCheckIns,
    todayCheckOuts,
    maintenanceRooms,
    blockedRooms,
    availableYears: await getAvailableRevenueYears(branchId),
  };
};

/*
  ===========================
  ADVANCED CHART ANALYTICS
  ===========================
*/

const ANALYTICS_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatHourLabel = (hour) => {
  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour} ${suffix}`;
};

const formatTwoHourRangeLabel = (startHour) => {
  const endHour = startHour + 2;
  const startLabel = formatHourLabel(startHour);
  const endLabel = formatHourLabel(endHour);
  return `${startLabel} - ${endLabel}`;
};

const getDatePartsInTimeZone = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const readPart = (type) => parts.find((part) => part.type === type)?.value || "00";

  return {
    year: Number(readPart("year")),
    month: Number(readPart("month")),
    day: Number(readPart("day")),
    hour: Number(readPart("hour")),
    minute: Number(readPart("minute")),
    second: Number(readPart("second")),
  };
};

const getLocalDateKey = (date, timeZone) => {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

const getLocalHour = (date, timeZone) => getDatePartsInTimeZone(date, timeZone).hour;

const isSameLocalDate = (leftDate, rightDate, timeZone) =>
  getLocalDateKey(leftDate, timeZone) === getLocalDateKey(rightDate, timeZone);

const getTwoHourBucketStart = (hour) => Math.floor(hour / 2) * 2;

const resolveAnalyticsTimeZone = async (user, branches = [], activeOrganizationIds = []) => {
  if (user?.branchId) {
    const branch = await ensureActiveBranch(user.branchId);
    if (branch?.timezone) {
      return branch.timezone;
    }
  }

  if (user?.role === "CORPORATE_ADMIN" && user.organizationId) {
    const organization = await Organization.findOne({ organizationId: user.organizationId })
      .select("timezone")
      .lean();

    if (organization?.timezone) {
      return organization.timezone;
    }
  }

  const uniqueBranchTimezones = [...new Set(branches.map((branch) => branch.timezone).filter(Boolean))];
  if (uniqueBranchTimezones.length === 1) {
    return uniqueBranchTimezones[0];
  }

  if (activeOrganizationIds.length === 1) {
    const organization = await Organization.findOne({ organizationId: activeOrganizationIds[0] })
      .select("timezone")
      .lean();

    if (organization?.timezone) {
      return organization.timezone;
    }
  }

  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
};

const getAnalyticsBuckets = (view, year, month) => {
  const normalizedView = view === "today" || view === "yearly" ? view : "monthly";
  const now = new Date();
  const selectedYear = parseInt(year, 10) || now.getFullYear();
  const parsedMonth = parseInt(month, 10);
  const selectedMonth = Number.isNaN(parsedMonth) ? now.getMonth() : parsedMonth;

  if (normalizedView === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const buckets = Array.from({ length: 12 }, (_, index) => {
      const startHour = index * 2;
      const start = new Date(startOfDay);
      start.setHours(startHour, 0, 0, 0);

      const end = new Date(start);
      end.setHours(startHour + 2, 0, 0, 0);

      return {
        key: `${start.toISOString().slice(0, 13)}:00`,
        label: formatTwoHourRangeLabel(startHour),
        start,
        end,
      };
    });

    return {
      view: normalizedView,
      year: selectedYear,
      month: selectedMonth,
      buckets,
      rangeStart: buckets[0].start,
      rangeEnd: buckets[buckets.length - 1].end,
    };
  }

  if (normalizedView === "monthly") {
    const monthStart = new Date(selectedYear, selectedMonth, 1);
    const nextMonthStart = new Date(selectedYear, selectedMonth + 1, 1);

    const buckets = [
      { startDay: 1, endDay: 8, label: "Week 1" },
      { startDay: 8, endDay: 15, label: "Week 2" },
      { startDay: 15, endDay: 22, label: "Week 3" },
      { startDay: 22, endDay: null, label: "Week 4" },
    ].map((bucket, index) => {
      const start = new Date(selectedYear, selectedMonth, bucket.startDay);
      const end = bucket.endDay
        ? new Date(selectedYear, selectedMonth, bucket.endDay)
        : nextMonthStart;

      return {
        key: `${selectedYear}-${String(selectedMonth + 1).padStart(2, "0")}-W${index + 1}`,
        label: bucket.label,
        start,
        end,
      };
    });

    return {
      view: normalizedView,
      year: selectedYear,
      month: selectedMonth,
      buckets,
      rangeStart: monthStart,
      rangeEnd: nextMonthStart,
    };
  }

  const buckets = ANALYTICS_MONTH_LABELS.map((label, index) => {
    const start = new Date(selectedYear, index, 1);
    const end = new Date(selectedYear, index + 1, 1);

    return {
      key: `${selectedYear}-${String(index + 1).padStart(2, "0")}`,
      label,
      start,
      end,
    };
  });

  return {
    view: normalizedView,
    year: selectedYear,
    month: selectedMonth,
    buckets,
    rangeStart: buckets[0].start,
    rangeEnd: buckets[buckets.length - 1].end,
  };
};

const buildEmptyChartData = (buckets) =>
  buckets.map((bucket) => ({
    label: bucket.label,
    bucketKey: bucket.key,
  }));

const getBucketKeyForDate = (date, buckets) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }

  const bucket = buckets.find((item) => date >= item.start && date < item.end);
  return bucket?.key || null;
};

const mergeDateAndTime = (dateValue, timeValue, fallbackTime) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const [hours, minutes] = String(timeValue || fallbackTime)
    .split(":")
    .map((value) => parseInt(value, 10));

  date.setHours(Number.isNaN(hours) ? 0 : hours, Number.isNaN(minutes) ? 0 : minutes, 0, 0);
  return date;
};

const buildComparison = (current, previous) => {
  let growth = 0;

  if (previous > 0) {
    growth = ((current - previous) / previous) * 100;
  } else if (current > 0) {
    growth = 100;
  }

  return {
    current,
    previous,
    growth,
  };
};

const getAnalyticsScope = async (user, mode = "branch") => {
  const chartMode = mode === "organization" ? "organization" : "branch";
  const activeBranchIds = await getScopedBranchIdsForUser(user);
  const activeOrganizationIds =
    user.role === "CORPORATE_ADMIN"
      ? await getActiveOrganizationIds({ organizationId: user.organizationId })
      : await getActiveOrganizationIds();

  if (!activeBranchIds.length || !activeOrganizationIds.length) {
    return {
      mode: chartMode,
      branches: [],
      branchIds: [],
      activeOrganizationIds,
      series: [],
    };
  }

  const branches = await Branch.find({
    _id: { $in: activeBranchIds },
    organizationId: { $in: activeOrganizationIds },
    isActive: true,
  })
    .select("_id name organizationId timezone")
    .sort({ name: 1 })
    .lean();

  if (!branches.length) {
    return {
      mode: chartMode,
      branches: [],
      branchIds: [],
      activeOrganizationIds,
      series: [],
    };
  }

  let series;

  if (chartMode === "organization") {
    const organizations = await Organization.find({
      organizationId: { $in: activeOrganizationIds },
      isActive: true,
    })
      .select("organizationId name")
      .sort({ name: 1 })
      .lean();

    series = organizations.map((organization) => ({
      key: organization.organizationId,
      name: organization.name,
      organizationId: organization.organizationId,
    }));
  } else {
    series = branches.map((branch) => ({
      key: branch._id.toString(),
      name: branch.name,
      organizationId: branch.organizationId,
    }));
  }

  return {
    mode: chartMode,
    branches,
    branchIds: branches.map((branch) => branch._id),
    activeOrganizationIds,
    series,
  };
};

const getActiveRoomCountsByBranch = async (branchIds = []) => {
  if (!branchIds.length) {
    return new Map();
  }

  const roomCounts = await Room.aggregate([
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
      },
    },
  ]);

  return new Map(
    roomCounts.map((item) => [item._id.toString(), item.totalRooms || 0]),
  );
};

const buildMetricChartData = ({
  buckets,
  series,
  branches,
  mode,
  valueMap,
  totalRoomsByBranch = new Map(),
  metricType = "sum",
}) => {
  const branchesByOrganization = new Map();

  branches.forEach((branch) => {
    const organizationId = branch.organizationId;

    if (!branchesByOrganization.has(organizationId)) {
      branchesByOrganization.set(organizationId, []);
    }

    branchesByOrganization.get(organizationId).push(branch);
  });

  return buckets.map((bucket) => {
    const point = {
      label: bucket.label,
      bucketKey: bucket.key,
    };

    series.forEach((entity) => {
      if (mode === "organization") {
        const organizationBranches = branchesByOrganization.get(entity.key) || [];

        if (metricType === "occupancy") {
          let occupiedRooms = 0;
          let totalRooms = 0;

          organizationBranches.forEach((branch) => {
            const branchKey = branch._id.toString();
            occupiedRooms += valueMap.get(`${branchKey}__${bucket.key}`) || 0;
            totalRooms += totalRoomsByBranch.get(branchKey) || 0;
          });

          point[entity.key] =
            totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(2)) : 0;
          return;
        }

        if (metricType === "revpar") {
          let revenue = 0;
          let totalRooms = 0;

          organizationBranches.forEach((branch) => {
            const branchKey = branch._id.toString();
            revenue += valueMap.get(`${branchKey}__${bucket.key}`) || 0;
            totalRooms += totalRoomsByBranch.get(branchKey) || 0;
          });

          point[entity.key] =
            totalRooms > 0 ? Number((revenue / totalRooms).toFixed(2)) : 0;
          return;
        }

        let totalValue = 0;
        organizationBranches.forEach((branch) => {
          totalValue += valueMap.get(`${branch._id.toString()}__${bucket.key}`) || 0;
        });

        point[entity.key] = totalValue;
        return;
      }

      const rawValue = valueMap.get(`${entity.key}__${bucket.key}`) || 0;

      if (metricType === "occupancy") {
        const totalRooms = totalRoomsByBranch.get(entity.key) || 0;
        point[entity.key] =
          totalRooms > 0 ? Number(((rawValue / totalRooms) * 100).toFixed(2)) : 0;
        return;
      }

      if (metricType === "revpar") {
        const totalRooms = totalRoomsByBranch.get(entity.key) || 0;
        point[entity.key] =
          totalRooms > 0 ? Number((rawValue / totalRooms).toFixed(2)) : 0;
        return;
      }

      point[entity.key] = rawValue;
    });

    return point;
  });
};

/*
  Revenue By Branch (Chart Data)
*/
exports.getRevenueByBranch = async (user, view, year, month, mode = "branch") => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const scope = await getAnalyticsScope(user, mode);
  const bucketMeta = getAnalyticsBuckets(view, year, month);
  const analyticsTimeZone = await resolveAnalyticsTimeZone(
    user,
    scope.branches,
    scope.activeOrganizationIds,
  );

  if (!scope.series.length) {
    return {
      series: [],
      year: bucketMeta.year,
      month: bucketMeta.month,
      view: bucketMeta.view,
      chartData: buildEmptyChartData(bucketMeta.buckets),
      comparison: null,
    };
  }

  const activeBranchMatch = buildBranchReferenceMatch(scope.branchIds);
  const todayFetchStart = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const roomRevenueDocs = await Invoice.find({
    isActive: true,
    referenceType: "BOOKING",
    status: "PAID",
    organizationId: { $in: scope.activeOrganizationIds },
    branchId: activeBranchMatch,
    createdAt: {
      $gte: bucketMeta.view === "today" ? todayFetchStart : bucketMeta.rangeStart,
      $lt: bucketMeta.rangeEnd,
    },
  })
    .select("branchId organizationId createdAt paidAmount")
    .lean();

  const posRevenueDocs = await POSOrder.find({
    isActive: true,
    paymentStatus: "PAID",
    organizationId: { $in: scope.activeOrganizationIds },
    branchId: activeBranchMatch,
    createdAt: {
      $gte: bucketMeta.view === "today" ? todayFetchStart : bucketMeta.rangeStart,
      $lt: bucketMeta.rangeEnd,
    },
  })
    .select("branchId organizationId createdAt subTotal")
    .lean();

  const revenueMap = new Map();
  const todayReferenceDate = new Date();

  [...roomRevenueDocs, ...posRevenueDocs].forEach((doc) => {
    const branchId = doc.branchId?.toString?.() || doc.branchId;
    let bucketKey = null;

    if (bucketMeta.view === "today") {
      if (!isSameLocalDate(doc.createdAt, todayReferenceDate, analyticsTimeZone)) {
        return;
      }

      bucketKey = bucketMeta.buckets.find(
        (bucket) => bucket.start.getHours() === getTwoHourBucketStart(getLocalHour(doc.createdAt, analyticsTimeZone)),
      )?.key || null;
    } else {
      bucketKey = getBucketKeyForDate(doc.createdAt, bucketMeta.buckets);
    }

    if (!branchId || !bucketKey) {
      return;
    }

    const compositeKey = `${branchId}__${bucketKey}`;
    const amount = doc.paidAmount || doc.subTotal || 0;
    revenueMap.set(compositeKey, (revenueMap.get(compositeKey) || 0) + amount);
  });

  const chartData = buildMetricChartData({
    buckets: bucketMeta.buckets,
    series: scope.series,
    branches: scope.branches,
    mode: scope.mode,
    valueMap: revenueMap,
    metricType: "sum",
  });

  let comparison = null;

  if (bucketMeta.view === "monthly") {
    const currentStart = new Date(bucketMeta.year, bucketMeta.month, 1);
    const currentEnd = new Date(bucketMeta.year, bucketMeta.month + 1, 1);
    const previousStart = new Date(bucketMeta.year, bucketMeta.month - 1, 1);

    const [previousRoomAgg, previousPosAgg, currentRoomAgg, currentPosAgg] = await Promise.all([
      Invoice.aggregate([
        {
          $match: {
            isActive: true,
            referenceType: "BOOKING",
            status: "PAID",
            organizationId: { $in: scope.activeOrganizationIds },
            branchId: activeBranchMatch,
            createdAt: { $gte: previousStart, $lt: currentStart },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$paidAmount" },
          },
        },
      ]),
      POSOrder.aggregate([
        {
          $match: {
            isActive: true,
            paymentStatus: "PAID",
            organizationId: { $in: scope.activeOrganizationIds },
            branchId: activeBranchMatch,
            createdAt: { $gte: previousStart, $lt: currentStart },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$subTotal" },
          },
        },
      ]),
      Invoice.aggregate([
        {
          $match: {
            isActive: true,
            referenceType: "BOOKING",
            status: "PAID",
            organizationId: { $in: scope.activeOrganizationIds },
            branchId: activeBranchMatch,
            createdAt: { $gte: currentStart, $lt: currentEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$paidAmount" },
          },
        },
      ]),
      POSOrder.aggregate([
        {
          $match: {
            isActive: true,
            paymentStatus: "PAID",
            organizationId: { $in: scope.activeOrganizationIds },
            branchId: activeBranchMatch,
            createdAt: { $gte: currentStart, $lt: currentEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$subTotal" },
          },
        },
      ]),
    ]);

    const currentTotal = (currentRoomAgg[0]?.total || 0) + (currentPosAgg[0]?.total || 0);
    const previousTotal = (previousRoomAgg[0]?.total || 0) + (previousPosAgg[0]?.total || 0);
    comparison = buildComparison(currentTotal, previousTotal);
  }

  return {
    series: scope.series,
    year: bucketMeta.year,
    month: bucketMeta.month,
    view: bucketMeta.view,
    chartData,
    comparison,
  };
};

/*
  Occupancy Trend
*/
exports.getOccupancyTrend = async (user, view, year, month, mode = "branch") => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const scope = await getAnalyticsScope(user, mode);
  const bucketMeta = getAnalyticsBuckets(view, year, month);

  if (!scope.series.length) {
    return {
      series: [],
      branches: [],
      year: bucketMeta.year,
      month: bucketMeta.month,
      view: bucketMeta.view,
      chartData: buildEmptyChartData(bucketMeta.buckets),
    };
  }

  const totalRoomsByBranch = await getActiveRoomCountsByBranch(scope.branchIds);
  const bookings = await Booking.find({
    isActive: true,
    status: { $ne: "CANCELLED" },
    branchId: { $in: scope.branchIds },
    checkInDate: { $lt: bucketMeta.rangeEnd },
    checkOutDate: { $gte: bucketMeta.rangeStart },
  })
    .select("branchId roomId checkInDate checkOutDate checkInTime checkOutTime")
    .lean();

  const occupiedRoomCountMap = new Map();

  bookings.forEach((booking) => {
    const branchId = booking.branchId?.toString?.() || booking.branchId;
    const roomId = booking.roomId?.toString?.() || booking.roomId;
    const bookingStart = mergeDateAndTime(booking.checkInDate, booking.checkInTime, "00:00");
    const bookingEnd = mergeDateAndTime(booking.checkOutDate, booking.checkOutTime, "23:59");

    if (!branchId || !roomId || !bookingStart || !bookingEnd) {
      return;
    }

    bucketMeta.buckets.forEach((bucket) => {
      if (bookingStart < bucket.end && bookingEnd > bucket.start) {
        const compositeKey = `${branchId}__${bucket.key}`;

        if (!occupiedRoomCountMap.has(compositeKey)) {
          occupiedRoomCountMap.set(compositeKey, new Set());
        }

        occupiedRoomCountMap.get(compositeKey).add(roomId);
      }
    });
  });

  const occupiedCountMap = new Map();
  occupiedRoomCountMap.forEach((roomSet, key) => {
    occupiedCountMap.set(key, roomSet.size);
  });

  const chartData = buildMetricChartData({
    buckets: bucketMeta.buckets,
    series: scope.series,
    branches: scope.branches,
    mode: scope.mode,
    valueMap: occupiedCountMap,
    totalRoomsByBranch,
    metricType: "occupancy",
  });

  return {
    series: scope.series,
    branches: scope.series,
    year: bucketMeta.year,
    month: bucketMeta.month,
    view: bucketMeta.view,
    chartData,
  };
};

/*
  RevPAR Trend
*/
exports.getRevPARTrend = async (user, view, year, month, mode = "branch") => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const scope = await getAnalyticsScope(user, mode);
  const bucketMeta = getAnalyticsBuckets(view, year, month);
  const analyticsTimeZone = await resolveAnalyticsTimeZone(
    user,
    scope.branches,
    scope.activeOrganizationIds,
  );

  if (!scope.series.length) {
    return {
      series: [],
      branches: [],
      year: bucketMeta.year,
      month: bucketMeta.month,
      view: bucketMeta.view,
      chartData: buildEmptyChartData(bucketMeta.buckets),
    };
  }

  const totalRoomsByBranch = await getActiveRoomCountsByBranch(scope.branchIds);
  const todayFetchStart = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const revenueDocs = await Invoice.find({
    isActive: true,
    referenceType: "BOOKING",
    organizationId: { $in: scope.activeOrganizationIds },
    branchId: { $in: scope.branchIds },
    createdAt: {
      $gte: bucketMeta.view === "today" ? todayFetchStart : bucketMeta.rangeStart,
      $lt: bucketMeta.rangeEnd,
    },
  })
    .select("branchId createdAt paidAmount")
    .lean();

  const revenueMap = new Map();
  const todayReferenceDate = new Date();

  revenueDocs.forEach((doc) => {
    const branchId = doc.branchId?.toString?.() || doc.branchId;
    let bucketKey = null;

    if (bucketMeta.view === "today") {
      if (!isSameLocalDate(doc.createdAt, todayReferenceDate, analyticsTimeZone)) {
        return;
      }

      bucketKey = bucketMeta.buckets.find(
        (bucket) => bucket.start.getHours() === getTwoHourBucketStart(getLocalHour(doc.createdAt, analyticsTimeZone)),
      )?.key || null;
    } else {
      bucketKey = getBucketKeyForDate(doc.createdAt, bucketMeta.buckets);
    }

    if (!branchId || !bucketKey) {
      return;
    }

    const compositeKey = `${branchId}__${bucketKey}`;
    revenueMap.set(compositeKey, (revenueMap.get(compositeKey) || 0) + (doc.paidAmount || 0));
  });

  const chartData = buildMetricChartData({
    buckets: bucketMeta.buckets,
    series: scope.series,
    branches: scope.branches,
    mode: scope.mode,
    valueMap: revenueMap,
    totalRoomsByBranch,
    metricType: "revpar",
  });

  return {
    series: scope.series,
    branches: scope.series,
    year: bucketMeta.year,
    month: bucketMeta.month,
    view: bucketMeta.view,
    chartData,
  };
};

/*
  Cancel Booking Trend
*/
exports.getCancelledBookingTrend = async (user, view, year, month, mode = "branch") => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const scope = await getAnalyticsScope(user, mode);
  const bucketMeta = getAnalyticsBuckets(view, year, month);
  const analyticsTimeZone = await resolveAnalyticsTimeZone(
    user,
    scope.branches,
    scope.activeOrganizationIds,
  );

  if (!scope.series.length) {
    return {
      series: [],
      branches: [],
      year: bucketMeta.year,
      month: bucketMeta.month,
      view: bucketMeta.view,
      chartData: buildEmptyChartData(bucketMeta.buckets),
    };
  }

  const todayFetchStart = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const cancelledBookings = await Booking.find({
    isActive: true,
    status: "CANCELLED",
    organizationId: { $in: scope.activeOrganizationIds },
    branchId: { $in: scope.branchIds },
    updatedAt: {
      $gte: bucketMeta.view === "today" ? todayFetchStart : bucketMeta.rangeStart,
      $lt: bucketMeta.rangeEnd,
    },
  })
    .select("branchId updatedAt")
    .lean();

  const cancellationMap = new Map();
  const todayReferenceDate = new Date();

  cancelledBookings.forEach((booking) => {
    const branchId = booking.branchId?.toString?.() || booking.branchId;
    let bucketKey = null;

    if (bucketMeta.view === "today") {
      if (!isSameLocalDate(booking.updatedAt, todayReferenceDate, analyticsTimeZone)) {
        return;
      }

      bucketKey = bucketMeta.buckets.find(
        (bucket) =>
          bucket.start.getHours() ===
          getTwoHourBucketStart(getLocalHour(booking.updatedAt, analyticsTimeZone)),
      )?.key || null;
    } else {
      bucketKey = getBucketKeyForDate(booking.updatedAt, bucketMeta.buckets);
    }

    if (!branchId || !bucketKey) {
      return;
    }

    const compositeKey = `${branchId}__${bucketKey}`;
    cancellationMap.set(compositeKey, (cancellationMap.get(compositeKey) || 0) + 1);
  });

  const chartData = buildMetricChartData({
    buckets: bucketMeta.buckets,
    series: scope.series,
    branches: scope.branches,
    mode: scope.mode,
    valueMap: cancellationMap,
    metricType: "sum",
  });

  return {
    series: scope.series,
    branches: scope.series,
    year: bucketMeta.year,
    month: bucketMeta.month,
    view: bucketMeta.view,
    chartData,
  };
};

/*
  ===========================
  ROOM REVENUE CHART
  ===========================
*/

exports.getRoomRevenueChart = async ({ user, branchId, view, year }) => {
  const activeBranch = await ensureActiveBranch(branchId);

  if (!activeBranch) {
    return [];
  }

  const selectedYear = parseInt(year) || new Date().getFullYear();
  if (view === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const timeZone = activeBranch.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const todayReferenceDate = new Date();
    const todayRevenueDocs = await Invoice.find({
      $expr: {
        $eq: ["$branchId", { $toObjectId: activeBranch._id.toString() }],
      },
      createdAt: { $gte: new Date(todayStart.getTime() - 36 * 60 * 60 * 1000), $lte: todayEnd },
      isActive: true,
      referenceType: "BOOKING",
    })
      .select("createdAt paidAmount")
      .lean();

    const revenueMap = new Map();

    todayRevenueDocs.forEach((doc) => {
      if (!isSameLocalDate(doc.createdAt, todayReferenceDate, timeZone)) {
        return;
      }

      const bucketStart = getTwoHourBucketStart(getLocalHour(doc.createdAt, timeZone));
      revenueMap.set(bucketStart, (revenueMap.get(bucketStart) || 0) + (doc.paidAmount || 0));
    });

    return Array.from(revenueMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucketStart, revenue]) => ({
        period: formatTwoHourRangeLabel(bucketStart),
        revenue,
      }));
  }

  if (view === "monthly") {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date();

    const monthlyResult = await Invoice.aggregate([
      {
        $match: {
          $expr: {
            $eq: ["$branchId", { $toObjectId: activeBranch._id.toString() }],
          },
          createdAt: { $gte: monthStart, $lte: monthEnd },
          isActive: true,
          referenceType: "BOOKING",
        },
      },
      {
        $addFields: {
          weekOfMonth: {
            $ceil: {
              $divide: [{ $dayOfMonth: "$createdAt" }, 7],
            },
          },
        },
      },
      {
        $group: {
          _id: "$weekOfMonth",
          revenue: { $sum: "$paidAmount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return monthlyResult.map((r) => ({
      week: `Week ${r._id}`,
      revenue: r.revenue,
    }));
  }

  if (view === "quarterly") {
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59, 999);

    const quarterlyResult = await Invoice.aggregate([
      {
        $match: {
          $expr: {
            $eq: ["$branchId", { $toObjectId: activeBranch._id.toString() }],
          },
          createdAt: { $gte: yearStart, $lte: yearEnd },
          isActive: true,
          referenceType: "BOOKING",
        },
      },
      {
        $addFields: {
          quarter: {
            $arrayElemAt: [
              ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"],
              {
                $floor: {
                  $divide: [{ $subtract: [{ $month: "$createdAt" }, 1] }, 3],
                },
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$quarter",
          revenue: { $sum: "$paidAmount" },
        },
      },
      {
        $addFields: {
          sortOrder: {
            $indexOfArray: [
              ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"],
              "$_id",
            ],
          },
        },
      },
      { $sort: { sortOrder: 1 } },
    ]);

    return quarterlyResult.map((r) => ({
      quarter: r._id,
      revenue: r.revenue,
    }));
  }

  if (view === "yearly") {
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59, 999);

    const result = await Invoice.aggregate([
      {
        $match: {
          $expr: {
            $eq: ["$branchId", { $toObjectId: activeBranch._id.toString() }],
          },
          createdAt: { $gte: yearStart, $lte: yearEnd },
          isActive: true,
          referenceType: "BOOKING",
        },
      },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          revenue: { $sum: "$paidAmount" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

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

    return result.map((r) => ({
      month: months[r._id.month - 1],
      revenue: r.revenue,
    }));
  }

  return [];
};

/*
  ===========================
  RESTAURANT REVENUE CHART
  ===========================
*/

exports.getRestaurantRevenueChart = async ({ user, branchId, view, year }) => {
  console.log("BranchId:", branchId);
  console.log("Selected Year:", year);

  const activeBranch = await ensureActiveBranch(branchId);

  if (!activeBranch) {
    return [];
  }

  const selectedYear = parseInt(year) || new Date().getFullYear();

  if (view === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const timeZone = activeBranch.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const todayReferenceDate = new Date();
    const result = await POSOrder.find({
      $expr: {
        $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: activeBranch._id.toString() }],
      },
      paymentStatus: "PAID",
      createdAt: { $gte: new Date(todayStart.getTime() - 36 * 60 * 60 * 1000), $lte: todayEnd },
      isActive: true,
    })
      .select("createdAt grandTotal")
      .lean();

    const revenueMap = new Map();

    result.forEach((doc) => {
      if (!isSameLocalDate(doc.createdAt, todayReferenceDate, timeZone)) {
        return;
      }

      const bucketStart = getTwoHourBucketStart(getLocalHour(doc.createdAt, timeZone));
      revenueMap.set(bucketStart, (revenueMap.get(bucketStart) || 0) + (doc.grandTotal || 0));
    });

    const finalData = Array.from(revenueMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucketStart, revenue]) => ({
        period: formatTwoHourRangeLabel(bucketStart),
        revenue,
      }));

    return finalData.length ? finalData : [];
  }

  if (view === "monthly") {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date();

    const monthlyResult = await POSOrder.aggregate([
      {
        $match: {
          $expr: {
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: activeBranch._id.toString() }],
          },
          createdAt: {
            $gte: monthStart,
            $lte: monthEnd,
          },
          isActive: true,
          paymentStatus: "PAID",
        },
      },
      {
        $addFields: {
          weekOfMonth: {
            $ceil: {
              $divide: [{ $dayOfMonth: "$createdAt" }, 7],
            },
          },
        },
      },
      {
        $group: {
          _id: "$weekOfMonth",
          revenue: { $sum: "$grandTotal" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const finalData = monthlyResult.map((r) => ({
      week: `Week ${r._id}`,
      revenue: r.revenue,
    }));

    return finalData.length ? finalData : [];
  }

  if (view === "quarterly") {
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59);

    const quarterlyResult = await POSOrder.aggregate([
      {
        $match: {
          $expr: {
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: activeBranch._id.toString() }],
          },
          createdAt: {
            $gte: yearStart,
            $lte: yearEnd,
          },
          isActive: true,
          paymentStatus: "PAID",
        },
      },
      {
        $addFields: {
          quarter: {
            $arrayElemAt: [
              ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"],
              {
                $floor: {
                  $divide: [{ $subtract: [{ $month: "$createdAt" }, 1] }, 3],
                },
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$quarter",
          revenue: { $sum: "$grandTotal" },
        },
      },
      {
        $addFields: {
          sortOrder: {
            $indexOfArray: [
              ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"],
              "$_id",
            ],
          },
        },
      },
      { $sort: { sortOrder: 1 } },
    ]);

    const finalData = quarterlyResult.map((r) => ({
      quarter: r._id,
      revenue: r.revenue,
    }));

    return finalData.length ? finalData : [];
  }

  if (view === "yearly") {
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59);

    const result = await POSOrder.aggregate([
      {
        $match: {
          $expr: {
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: activeBranch._id.toString() }],
          },
          paymentStatus: "PAID",
          createdAt: { $gte: yearStart, $lte: yearEnd },
          isActive: true,
        },
      },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          revenue: { $sum: "$grandTotal" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

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

    const finalData = result.map((r) => ({
      month: months[r._id.month - 1],
      revenue: r.revenue,
    }));

    return finalData.length ? finalData : [];
  }

  return [];
};
