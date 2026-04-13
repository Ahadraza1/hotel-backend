const mongoose = require("mongoose");
const Booking = require("../booking/booking.model");
const Room = require("../room/room.model");
const POSOrder = require("../pos/posOrder.model");
const Housekeeping = require("../housekeeping/housekeeping.model");
const Guest = require("../crm/guest.model");
const Staff = require("../hr/staff.model");

const REPORT_TIMEZONE = "UTC";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toDateKey = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfUtcDay = (value) => {
  const date = value ? new Date(value) : new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
};

const endOfUtcDay = (value) => {
  const date = value ? new Date(value) : new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
};

const normalizeDateRange = ({ startDate, endDate }) => {
  const resolvedEndDate = endDate ? endOfUtcDay(endDate) : endOfUtcDay(new Date());
  const resolvedStartDate = startDate
    ? startOfUtcDay(startDate)
    : startOfUtcDay(new Date(resolvedEndDate.getTime() - 6 * DAY_IN_MS));

  if (resolvedStartDate.getTime() > resolvedEndDate.getTime()) {
    throw new Error("Start date must be before end date");
  }

  return {
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
  };
};

const buildDateSeries = (startDate, endDate, fillValue = 0) => {
  const series = [];

  for (
    let cursor = startOfUtcDay(startDate);
    cursor.getTime() <= endDate.getTime();
    cursor = new Date(cursor.getTime() + DAY_IN_MS)
  ) {
    series.push({
      date: toDateKey(cursor),
      value: fillValue,
    });
  }

  return series;
};

const applySeriesValues = (series, rows, field) => {
  const lookup = new Map(rows.map((row) => [row._id, Number(row[field] || 0)]));

  return series.map((entry) => ({
    date: entry.date,
    value: lookup.get(entry.date) || 0,
  }));
};

const toNumber = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const getObjectId = (branchId) => {
  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    throw new Error("Invalid branch id");
  }

  return new mongoose.Types.ObjectId(branchId);
};

const getSubscriptionFeatures = (user) =>
  new Set(
    (user?.subscriptionAccess?.activePlan?.features || [])
      .map((feature) => String(feature || "").trim().toLowerCase())
      .filter(Boolean),
  );

const assertFeatureEnabled = (user, featureKey) => {
  const role = String(user?.role || "").toUpperCase();

  if (user?.isPlatformAdmin || role === "SUPER_ADMIN") {
    return;
  }

  const features = getSubscriptionFeatures(user);

  if (!features.has(String(featureKey || "").trim().toLowerCase())) {
    const error = new Error("This report is not available in your subscription plan.");
    error.statusCode = 403;
    error.code = "FEATURE_LOCKED";
    throw error;
  }
};

const ensureBranchAccess = (user, branchId) => {
  const requestedBranchId = String(branchId || "");
  const activeBranchId = String(user?.branchId || "");
  const role = String(user?.role || "").toUpperCase();

  if (!requestedBranchId) {
    throw new Error("Branch id is required");
  }

  if (!activeBranchId) {
    return;
  }

  if (!["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(role) && activeBranchId !== requestedBranchId) {
    const error = new Error("Access denied to this branch");
    error.statusCode = 403;
    throw error;
  }
};

const serializeMeta = (branchId, startDate, endDate) => ({
  branchId,
  startDate: startDate.toISOString(),
  endDate: endDate.toISOString(),
});

exports.getRoomsReport = async ({ user, branchId, startDate, endDate }) => {
  assertFeatureEnabled(user, "reports_rooms");
  ensureBranchAccess(user, branchId);

  const branchObjectId = getObjectId(branchId);
  const range = normalizeDateRange({ startDate, endDate });
  const activeBookingMatch = {
    branchId: branchObjectId,
    isActive: true,
    status: { $ne: "CANCELLED" },
    checkInDate: { $lte: range.endDate },
    checkOutDate: { $gte: range.startDate },
  };
  const rangedBookingMatch = {
    branchId: branchObjectId,
    isActive: true,
    createdAt: { $gte: range.startDate, $lte: range.endDate },
  };
  const nonCancelledMatch = {
    ...rangedBookingMatch,
    status: { $ne: "CANCELLED" },
  };

  const [totalRooms, occupiedRoomsResult, totalsResult, revenueTrend, bookingTrend, bookingSourceRows, cancelledBookings] =
    await Promise.all([
      Room.countDocuments({ branchId: branchObjectId, isActive: true }),
      Booking.aggregate([
        { $match: activeBookingMatch },
        { $group: { _id: "$roomId" } },
        { $count: "occupiedRooms" },
      ]),
      Booking.aggregate([
        { $match: nonCancelledMatch },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$totalAmount" },
            roomsSold: { $sum: 1 },
            totalBookings: { $sum: 1 },
          },
        },
      ]),
      Booking.aggregate([
        { $match: nonCancelledMatch },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: REPORT_TIMEZONE,
              },
            },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        { $match: nonCancelledMatch },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: REPORT_TIMEZONE,
              },
            },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Booking.aggregate([
        { $match: nonCancelledMatch },
        {
          $project: {
            source: {
              $switch: {
                branches: [
                  { case: { $eq: ["$bookingSource", "Walk-in"] }, then: "Walk-in" },
                  { case: { $eq: ["$bookingSource", "Online"] }, then: "Online" },
                ],
                default: "Direct",
              },
            },
          },
        },
        { $group: { _id: "$source", value: { $sum: 1 } } },
      ]),
      Booking.countDocuments({
        ...rangedBookingMatch,
        status: "CANCELLED",
      }),
    ]);

  const occupiedRooms = Number(occupiedRoomsResult[0]?.occupiedRooms || 0);
  const totals = totalsResult[0] || {};
  const totalRevenue = Number(totals.totalRevenue || 0);
  const roomsSold = Number(totals.roomsSold || 0);
  const totalBookings = Number(totals.totalBookings || 0);
  const baseSeries = buildDateSeries(range.startDate, range.endDate);

  return {
    meta: serializeMeta(branchId, range.startDate, range.endDate),
    summary: {
      occupancyRate: totalRooms > 0 ? toNumber((occupiedRooms / totalRooms) * 100) : 0,
      occupiedRooms,
      totalRooms,
      adr: roomsSold > 0 ? toNumber(totalRevenue / roomsSold) : 0,
      revpar: totalRooms > 0 ? toNumber(totalRevenue / totalRooms) : 0,
      cancellationRate:
        totalBookings + cancelledBookings > 0
          ? toNumber((cancelledBookings / (totalBookings + cancelledBookings)) * 100)
          : 0,
      totalRevenue: toNumber(totalRevenue),
      roomsSold,
      totalBookings,
      cancelledBookings,
    },
    revenueTrend: applySeriesValues(baseSeries, revenueTrend, "revenue"),
    bookingTrends: applySeriesValues(baseSeries, bookingTrend, "bookings"),
    bookingSources: [
      { name: "Direct", value: 0 },
      { name: "Online", value: 0 },
      { name: "Walk-in", value: 0 },
    ].map((entry) => ({
      ...entry,
      value: Number(bookingSourceRows.find((row) => row._id === entry.name)?.value || 0),
    })),
  };
};

exports.getRestaurantReport = async ({ user, branchId, startDate, endDate }) => {
  assertFeatureEnabled(user, "reports_restaurant");
  ensureBranchAccess(user, branchId);

  const range = normalizeDateRange({ startDate, endDate });
  const match = {
    branchId: String(branchId),
    isActive: true,
    createdAt: { $gte: range.startDate, $lte: range.endDate },
    orderStatus: { $ne: "CANCELLED" },
  };

  const [totalsResult, dailySalesRows, topItemsRows, orderTypeRows, peakHourRows] = await Promise.all([
    POSOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$grandTotal" },
          totalOrders: { $sum: 1 },
        },
      },
    ]),
    POSOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: REPORT_TIMEZONE,
            },
          },
          revenue: { $sum: "$grandTotal" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    POSOrder.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.nameSnapshot",
          quantity: { $sum: "$items.quantity" },
          revenue: { $sum: "$items.totalItemAmount" },
        },
      },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 6 },
    ]),
    POSOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$orderType",
          value: { $sum: 1 },
        },
      },
    ]),
    POSOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $hour: {
              date: "$createdAt",
              timezone: REPORT_TIMEZONE,
            },
          },
          orders: { $sum: 1 },
        },
      },
      { $sort: { orders: -1, _id: 1 } },
      { $limit: 6 },
    ]),
  ]);

  const totals = totalsResult[0] || {};
  const totalRevenue = Number(totals.totalRevenue || 0);
  const totalOrders = Number(totals.totalOrders || 0);
  const baseSeries = buildDateSeries(range.startDate, range.endDate);

  return {
    meta: serializeMeta(branchId, range.startDate, range.endDate),
    summary: {
      totalRevenue: toNumber(totalRevenue),
      totalOrders,
      averageOrderValue: totalOrders > 0 ? toNumber(totalRevenue / totalOrders) : 0,
    },
    dailySalesRevenue: applySeriesValues(baseSeries, dailySalesRows, "revenue"),
    topSellingItems: topItemsRows.map((row) => ({
      name: row._id || "Item",
      quantity: Number(row.quantity || 0),
      revenue: toNumber(row.revenue || 0),
    })),
    orderTypeDistribution: [
      { name: "Dine-in", value: 0 },
      { name: "Room Service", value: 0 },
      { name: "Takeaway", value: 0 },
    ].map((entry) => {
      const lookupKey =
        entry.name === "Dine-in" ? "DINE_IN" : entry.name === "Room Service" ? "ROOM_SERVICE" : "TAKEAWAY";
      return {
        ...entry,
        value: Number(orderTypeRows.find((row) => row._id === lookupKey)?.value || 0),
      };
    }),
    peakHours: peakHourRows
      .map((row) => ({
        hour: `${String(row._id).padStart(2, "0")}:00`,
        orders: Number(row.orders || 0),
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
  };
};

exports.getHousekeepingReport = async ({ user, branchId, startDate, endDate }) => {
  assertFeatureEnabled(user, "reports_housekeeping");
  ensureBranchAccess(user, branchId);

  const branchObjectId = getObjectId(branchId);
  const range = normalizeDateRange({ startDate, endDate });
  const match = {
    branchId: branchObjectId,
    isActive: true,
    createdAt: { $gte: range.startDate, $lte: range.endDate },
  };

  const [statusRows, completionRows, averageTimeRows, productivityRows] = await Promise.all([
    Housekeeping.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $cond: [{ $in: ["$status", ["CLEAN", "INSPECTED"]] }, "Cleaned", "Pending"],
          },
          value: { $sum: 1 },
        },
      },
    ]),
    Housekeeping.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: {
              $cond: [{ $in: ["$status", ["CLEAN", "INSPECTED"]] }, 1, 0],
            },
          },
        },
      },
    ]),
    Housekeeping.aggregate([
      {
        $match: {
          ...match,
          completedAt: { $type: "date", $gte: range.startDate, $lte: range.endDate },
        },
      },
      {
        $project: {
          durationMinutes: {
            $divide: [{ $subtract: ["$completedAt", "$createdAt"] }, 1000 * 60],
          },
        },
      },
      {
        $group: {
          _id: null,
          averageCleaningTime: { $avg: "$durationMinutes" },
        },
      },
    ]),
    Housekeeping.aggregate([
      { $match: { ...match, assignedTo: { $ne: null } } },
      {
        $group: {
          _id: "$assignedTo",
          tasks: { $sum: 1 },
          completedTasks: {
            $sum: {
              $cond: [{ $in: ["$status", ["CLEAN", "INSPECTED"]] }, 1, 0],
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $project: {
          _id: 0,
          name: {
            $ifNull: [{ $arrayElemAt: ["$user.name", 0] }, "Staff"],
          },
          tasks: 1,
          completedTasks: 1,
        },
      },
      { $sort: { tasks: -1, completedTasks: -1, name: 1 } },
      { $limit: 6 },
    ]),
  ]);

  const totals = completionRows[0] || {};
  const totalTasks = Number(totals.totalTasks || 0);
  const completedTasks = Number(totals.completedTasks || 0);
  const statusMap = new Map(statusRows.map((row) => [row._id, Number(row.value || 0)]));

  return {
    meta: serializeMeta(branchId, range.startDate, range.endDate),
    summary: {
      totalTasks,
      completedTasks,
      pendingTasks: statusMap.get("Pending") || 0,
      taskCompletionRate: totalTasks > 0 ? toNumber((completedTasks / totalTasks) * 100) : 0,
      averageCleaningTime: toNumber(averageTimeRows[0]?.averageCleaningTime || 0),
    },
    roomsCleanedVsPending: [
      { name: "Cleaned", value: statusMap.get("Cleaned") || 0 },
      { name: "Pending", value: statusMap.get("Pending") || 0 },
    ],
    staffProductivity: productivityRows.map((row) => ({
      name: row.name || "Staff",
      tasks: Number(row.tasks || 0),
      completedTasks: Number(row.completedTasks || 0),
    })),
  };
};

exports.getCrmReport = async ({ user, branchId, startDate, endDate }) => {
  assertFeatureEnabled(user, "reports_crm");
  ensureBranchAccess(user, branchId);

  const branchObjectId = getObjectId(branchId);
  const range = normalizeDateRange({ startDate, endDate });
  const guestMatch = {
    branchId: branchObjectId,
    isActive: true,
  };
  const periodGuestMatch = {
    ...guestMatch,
    createdAt: { $gte: range.startDate, $lte: range.endDate },
  };

  const [newGuests, returningGuests, frequencyRows, topCustomers, staffRatings] = await Promise.all([
    Guest.countDocuments(periodGuestMatch),
    Guest.countDocuments({
      ...guestMatch,
      lastStay: { $gte: range.startDate, $lte: range.endDate },
      totalStays: { $gt: 1 },
    }),
    Guest.aggregate([
      { $match: guestMatch },
      {
        $project: {
          bucket: {
            $switch: {
              branches: [
                { case: { $lte: ["$totalStays", 1] }, then: "1 Stay" },
                {
                  case: {
                    $and: [{ $gte: ["$totalStays", 2] }, { $lte: ["$totalStays", 3] }],
                  },
                  then: "2-3 Stays",
                },
              ],
              default: "4+ Stays",
            },
          },
        },
      },
      { $group: { _id: "$bucket", value: { $sum: 1 } } },
    ]),
    Guest.find(guestMatch)
      .sort({ totalSpent: -1, totalStays: -1, createdAt: 1 })
      .limit(5)
      .lean(),
    Staff.aggregate([
      {
        $match: {
          branchId: String(branchId),
          isActive: true,
          isDeleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$performanceRating",
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    meta: {
      ...serializeMeta(branchId, range.startDate, range.endDate),
      satisfactionSource: "staff_performance_proxy",
    },
    summary: {
      newCustomers: Number(newGuests || 0),
      returningCustomers: Number(returningGuests || 0),
      totalTrackedCustomers: Number(newGuests || 0) + Number(returningGuests || 0),
    },
    newVsReturningCustomers: [
      { name: "New", value: Number(newGuests || 0) },
      { name: "Returning", value: Number(returningGuests || 0) },
    ],
    customerSatisfactionRatings: [1, 2, 3, 4, 5].map((rating) => ({
      name: `${rating} Star`,
      value: Number(staffRatings.find((row) => Number(row._id) === rating)?.value || 0),
    })),
    bookingFrequency: [
      { name: "1 Stay", value: 0 },
      { name: "2-3 Stays", value: 0 },
      { name: "4+ Stays", value: 0 },
    ].map((entry) => ({
      ...entry,
      value: Number(frequencyRows.find((row) => row._id === entry.name)?.value || 0),
    })),
    topCustomers: topCustomers.map((guest) => ({
      id: guest._id?.toString(),
      name: `${guest.firstName || ""} ${guest.lastName || ""}`.trim() || guest.email || guest.phone || "Guest",
      email: guest.email || "",
      totalSpent: toNumber(guest.totalSpent || 0),
      totalStays: Number(guest.totalStays || 0),
      loyaltyPoints: Number(guest.loyaltyPoints || 0),
      vipStatus: !!guest.vipStatus,
    })),
  };
};
