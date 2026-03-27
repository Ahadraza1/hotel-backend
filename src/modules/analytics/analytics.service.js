const mongoose = require("mongoose");
const Room = require("../room/room.model");
const Booking = require("../booking/booking.model");
const Invoice = require("../invoice/invoice.model");
const Branch = require("../branch/branch.model");
const POSOrder = require("../pos/posOrder.model");
const Organization = require("../organization/organization.model");

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

    /*
      1. ROOM REVENUE (INVOICE)
    */
    const roomRevenue = await Invoice.aggregate([
      {
        $match: {
          isActive: true,
          status: "PAID",
          referenceType: "BOOKING",
          ...(user.role === "CORPORATE_ADMIN" ? { organizationId: user.organizationId } : {})
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
          ...(user.role === "CORPORATE_ADMIN" ? { organizationId: user.organizationId } : {})
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
        _id: { $in: orgTotals.map(o => o.organizationId) }
      });

      const bestData = organizations.find(o => o._id.toString() === bestOrg.organizationId);
      const lowestData = organizations.find(o => o._id.toString() === lowestOrg.organizationId);

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
    const branchMatch = { isActive: true };
    if (user.role === "CORPORATE_ADMIN") {
      branchMatch.organizationId = user.organizationId;
    }

    const branchesRaw = await Branch.find(branchMatch).select("_id name totalRooms");
    
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
  const branchObjectId = new mongoose.Types.ObjectId(branchId);
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
    status: { $in: ["CONFIRMED", "CHECKED_IN"] },
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

/*
  Revenue By Branch (Chart Data)
*/
exports.getRevenueByBranch = async (user, view, year, month) => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const match = {
    isActive: true
  };

  if (user.role === "CORPORATE_ADMIN") {
    match.organizationId = user.organizationId;
  }

  let start, end;

  if (view === "today") {
    start = new Date();
    start.setHours(0, 0, 0, 0);

    end = new Date();
    end.setHours(23, 59, 59, 999);
  } else if (view === "monthly") {
    let parsedMonth = parseInt(month);
    const selectedMonth = isNaN(parsedMonth) ? new Date().getMonth() : parsedMonth;
    const selectedYear = parseInt(year) || new Date().getFullYear();

    start = new Date(selectedYear, selectedMonth, 1);
    end = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
  } else if (view === "yearly") {
    const selectedYear = parseInt(year) || new Date().getFullYear();

    start = new Date(selectedYear, 0, 1);
    end = new Date(selectedYear, 11, 31, 23, 59, 59);
  }

  // Room Revenue
  const roomRevenue = await Invoice.aggregate([
    {
      $match: {
        ...match,
        referenceType: "BOOKING",
        status: "PAID",
        createdAt: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: "$branchId",
        revenue: { $sum: "$paidAmount" }
      }
    }
  ]);

  // POS Revenue
  const posRevenue = await POSOrder.aggregate([
    {
      $match: {
        ...match,
        paymentStatus: "PAID",
        createdAt: { $gte: start, $lte: end }
      }
    },
    {
      $group: {
        _id: "$branchId",
        revenue: { $sum: "$subTotal" }
      }
    }
  ]);

  const revenueMap = {};

  roomRevenue.forEach(item => {
    const bId = item._id.toString();
    revenueMap[bId] = (revenueMap[bId] || 0) + item.revenue;
  });

  posRevenue.forEach(item => {
    const bId = item._id.toString();
    revenueMap[bId] = (revenueMap[bId] || 0) + item.revenue;
  });

  const branchIds = Object.keys(revenueMap);

  const branches = await Branch.find({
    _id: { $in: branchIds }
  });

  const result = branches.map(branch => ({
    branchName: branch.name,
    revenue: revenueMap[branch._id.toString()] || 0
  }));

  result.sort((a, b) => b.revenue - a.revenue);

  let comparison = null;

  if (view === "monthly") {
    let parsedMonth = parseInt(month);
    const selectedMonth = isNaN(parsedMonth) ? new Date().getMonth() : parsedMonth;
    const selectedYear = parseInt(year) || new Date().getFullYear();

    const prevStart = new Date(selectedYear, selectedMonth - 1, 1);
    const prevEnd = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);

    const prevRoomRevenue = await Invoice.aggregate([
      {
        $match: {
          ...match,
          referenceType: "BOOKING",
          status: "PAID",
          createdAt: { $gte: prevStart, $lte: prevEnd }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$paidAmount" }
        }
      }
    ]);

    const prevPosRevenue = await POSOrder.aggregate([
      {
        $match: {
          ...match,
          paymentStatus: "PAID",
          createdAt: { $gte: prevStart, $lte: prevEnd }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$subTotal" }
        }
      }
    ]);

    const current = result.reduce((sum, item) => sum + item.revenue, 0);
    const previous = (prevRoomRevenue[0]?.total || 0) + (prevPosRevenue[0]?.total || 0);

    let growth = 0;
    if (previous > 0) {
      growth = ((current - previous) / previous) * 100;
    } else if (current > 0) {
      growth = 100; // 100% growth from 0
    }

    comparison = {
      current,
      previous,
      growth
    };
  }

  return {
    chartData: result,
    comparison
  };
};

/*
  Occupancy Trend (Branch-wise Monthly)
  Occupancy (%) = booked rooms / total active rooms * 100
*/
exports.getOccupancyTrend = async (user, year) => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const branchFilter = { isActive: true };
  if (user.role === "CORPORATE_ADMIN") {
    branchFilter.organizationId = user.organizationId;
  }

  const selectedYear = parseInt(year, 10) || new Date().getFullYear();
  const monthWindows = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const start = new Date(selectedYear, monthIndex, 1);
    const end = new Date(selectedYear, monthIndex + 1, 1);

    monthWindows.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleString("en-US", { month: "short" }),
      start,
      end,
    });
  }

  const rangeStart = monthWindows[0].start;
  const rangeEnd = monthWindows[monthWindows.length - 1].end;

  const branches = await Branch.find(branchFilter)
    .select("_id name organizationId")
    .sort({ name: 1 })
    .lean();

  if (!branches.length) {
    return {
      branches: [],
      chartData: monthWindows.map((month) => ({
        month: month.label,
        monthKey: month.key,
      })),
    };
  }

  const branchIds = branches.map((branch) => branch._id);

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

  const totalRoomsByBranch = new Map(
    roomCounts.map((item) => [item._id.toString(), item.totalRooms || 0]),
  );

  const bookings = await Booking.find({
    isActive: true,
    status: { $ne: "CANCELLED" },
    branchId: { $in: branchIds },
    checkInDate: { $lt: rangeEnd },
    checkOutDate: { $gt: rangeStart },
  })
    .select("branchId roomId checkInDate checkOutDate")
    .lean();

  const bookedRoomsByBranchAndMonth = new Map();

  bookings.forEach((booking) => {
    const branchId = booking.branchId?.toString();
    const roomId = booking.roomId?.toString();

    if (!branchId || !roomId) {
      return;
    }

    monthWindows.forEach((month) => {
      if (booking.checkInDate < month.end && booking.checkOutDate > month.start) {
        const compositeKey = `${branchId}__${month.key}`;

        if (!bookedRoomsByBranchAndMonth.has(compositeKey)) {
          bookedRoomsByBranchAndMonth.set(compositeKey, new Set());
        }

        bookedRoomsByBranchAndMonth.get(compositeKey).add(roomId);
      }
    });
  });

  const branchSeries = branches.map((branch) => ({
    key: branch._id.toString(),
    name: branch.name,
    organizationId: branch.organizationId,
  }));

  const chartData = monthWindows.map((month) => {
    const point = {
      month: month.label,
      monthKey: month.key,
    };

    branchSeries.forEach((branch) => {
      const totalRooms = totalRoomsByBranch.get(branch.key) || 0;
      const bookedRooms =
        bookedRoomsByBranchAndMonth.get(`${branch.key}__${month.key}`)?.size || 0;

      point[branch.key] =
        totalRooms > 0 ? Number(((bookedRooms / totalRooms) * 100).toFixed(2)) : 0;
    });

    return point;
  });

    return {
      branches: branchSeries,
      year: selectedYear,
      chartData,
    };
};

/*
  RevPAR Trend (Branch-wise Monthly)
  RevPAR = Total Room Revenue / Total Available Rooms
*/
exports.getRevPARTrend = async (user, year) => {
  if (user.role !== "SUPER_ADMIN" && user.role !== "CORPORATE_ADMIN") {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  const branchFilter = { isActive: true };
  if (user.role === "CORPORATE_ADMIN") {
    branchFilter.organizationId = user.organizationId;
  }

  const selectedYear = parseInt(year, 10) || new Date().getFullYear();
  const startOfYear = new Date(selectedYear, 0, 1);
  const endOfYear = new Date(selectedYear, 11, 31, 23, 59, 59);

  const branches = await Branch.find(branchFilter)
    .select("_id name organizationId totalRooms")
    .sort({ name: 1 })
    .lean();

  if (!branches.length) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return {
      branches: [],
      chartData: months.map((month) => ({
        month,
        monthKey: `${selectedYear}-${String(months.indexOf(month) + 1).padStart(2, "0")}`,
      })),
    };
  }

  const branchIds = branches.map((branch) => branch._id);

  // Group Revenue by Branch and Month
  const revenueTrend = await Invoice.aggregate([
    {
      $match: {
        isActive: true,
        referenceType: "BOOKING",
        branchId: { $in: branchIds },
        createdAt: { $gte: startOfYear, $lte: endOfYear }
      }
    },
    {
      $group: {
        _id: {
          branchId: "$branchId",
          month: { $month: "$createdAt" }
        },
        revenue: { $sum: "$paidAmount" }
      }
    }
  ]);

  const revenueMap = new Map();
  revenueTrend.forEach(item => {
    revenueMap.set(`${item._id.branchId}__${item._id.month}`, item.revenue);
  });

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const branchSeries = branches.map((branch) => ({
    key: branch._id.toString(),
    name: branch.name,
    organizationId: branch.organizationId,
  }));

  const chartData = months.map((monthLabel, index) => {
    const monthNumber = index + 1;
    const point = {
      month: monthLabel,
      monthKey: `${selectedYear}-${String(monthNumber).padStart(2, "0")}`,
    };

    branchSeries.forEach((branch) => {
      // Find branch in the original branches list to get totalRooms
      const branchInfo = branches.find(b => b._id.toString() === branch.key);
      const totalRooms = branchInfo?.totalRooms || 0;
      const revenue = revenueMap.get(`${branch.key}__${monthNumber}`) || 0;

      point[branch.key] = totalRooms > 0 ? Number((revenue / totalRooms).toFixed(2)) : 0;
    });

    return point;
  });

  return {
    branches: branchSeries,
    year: selectedYear,
    chartData,
  };
};

/*
  ===========================
  ROOM REVENUE CHART
  ===========================
*/

exports.getRoomRevenueChart = async ({ user, branchId, view, year }) => {
  const selectedYear = parseInt(year) || new Date().getFullYear();
  if (view === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // const testData = await Invoice.find().limit(5);
    // // console.log("Sample Invoice Data:", testData);

    const todayRevenueAgg = await Invoice.aggregate([
      {
        $match: {
          $expr: {
            $eq: ["$branchId", { $toObjectId: branchId }],
          },
          createdAt: { $gte: todayStart, $lte: todayEnd },
          isActive: true,
          referenceType: "BOOKING",
        }
      },
      {
        $addFields: {
          hour: { $hour: "$createdAt" },
        },
      },
      {
        $addFields: {
          period: {
            $switch: {
              branches: [
                { case: { $lt: ["$hour", 6] }, then: "12AM-6AM" },
                { case: { $lt: ["$hour", 12] }, then: "6AM-12PM" },
                { case: { $lt: ["$hour", 18] }, then: "12PM-6PM" },
              ],
              default: "6PM-12AM",
            },
          },
        },
      },
      {
        $group: {
          _id: "$period",
          revenue: { $sum: "$paidAmount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const formatHour = (h) => {
      const suffix = h >= 12 ? "PM" : "AM";
      const hour = h % 12 === 0 ? 12 : h % 12;
      return `${hour}${suffix}`;
    };

    return todayRevenueAgg.map((r) => ({
      period: r._id,
      revenue: r.revenue,
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
            $eq: ["$branchId", { $toObjectId: branchId }],
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
            $eq: ["$branchId", { $toObjectId: branchId }],
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
            $eq: ["$branchId", { $toObjectId: branchId }],
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

  const selectedYear = parseInt(year) || new Date().getFullYear();

  if (view === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const result = await POSOrder.aggregate([
      {
        $match: {
          $expr: {
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: branchId }],
          },
          paymentStatus: "PAID",
          createdAt: { $gte: todayStart, $lte: todayEnd },
          isActive: true,
        },
      },
      {
        $addFields: {
          hour: { $hour: "$createdAt" },
        },
      },
      {
        $addFields: {
          period: {
            $switch: {
              branches: [
                { case: { $lt: ["$hour", 6] }, then: "12AM-6AM" },
                { case: { $lt: ["$hour", 12] }, then: "6AM-12PM" },
                { case: { $lt: ["$hour", 18] }, then: "12PM-6PM" },
              ],
              default: "6PM-12AM",
            },
          },
        },
      },
      {
        $group: {
          _id: "$period",
          revenue: { $sum: "$grandTotal" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const finalData = result.map((r) => ({
      period: r._id,
      revenue: r.revenue,
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
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: branchId }],
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
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: branchId }],
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
            $eq: [{ $toObjectId: "$branchId" }, { $toObjectId: branchId }],
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
