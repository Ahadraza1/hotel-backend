const Organization = require("../organization/organization.model");
const OrganizationSubscription = require("../subscription/organizationSubscription.model");
const SubscriptionPayment = require("../subscription/subscriptionPayment.model");
const Invoice = require("../invoice/invoice.model");

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const getDateBounds = () => {
  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);

  return {
    now,
    startOfToday,
    startOfTomorrow,
    startOfMonth,
    startOfNextMonth,
    startOfYear,
    startOfNextYear,
  };
};

const sumSubscriptionRevenue = async (match = {}) => {
  const result = await SubscriptionPayment.aggregate([
    {
      $match: {
        status: "success",
        ...match,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
      },
    },
  ]);

  return result[0]?.total || 0;
};

exports.getOverview = async () => {
  const {
    startOfToday,
    startOfTomorrow,
    startOfMonth,
    startOfNextMonth,
    startOfYear,
    startOfNextYear,
  } = getDateBounds();

  const [
    totalSubscriptionRevenue,
    todayRevenue,
    monthlySubscriptionRevenue,
    yearlyRevenue,
    activeInvoices,
  ] = await Promise.all([
    sumSubscriptionRevenue(),
    sumSubscriptionRevenue({
      paymentDate: { $gte: startOfToday, $lt: startOfTomorrow },
    }),
    sumSubscriptionRevenue({
      paymentDate: { $gte: startOfMonth, $lt: startOfNextMonth },
    }),
    sumSubscriptionRevenue({
      paymentDate: { $gte: startOfYear, $lt: startOfNextYear },
    }),
    Invoice.countDocuments({
      status: { $in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] },
    }),
  ]);

  return {
    monthlyRevenue: monthlySubscriptionRevenue,
    mrr: 0,
    refunds: 0,
    activeInvoices,
    totalSubscriptionRevenue,
    todayRevenue,
    monthlySubscriptionRevenue,
    yearlyRevenue,
  };
};

exports.getMonthlyRevenue = async () => {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const offset = 5 - index;
    return new Date(now.getFullYear(), now.getMonth() - offset, 1);
  });

  const startDate = months[0];
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const rows = await SubscriptionPayment.aggregate([
    {
      $match: {
        status: "success",
        paymentDate: { $gte: startDate, $lt: endDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$paymentDate" },
          month: { $month: "$paymentDate" },
        },
        revenue: { $sum: "$amount" },
      },
    },
  ]);

  const revenueMap = new Map(
    rows.map((row) => [`${row._id.year}-${row._id.month}`, row.revenue]),
  );

  return months.map((date) => ({
    month: MONTH_LABELS[date.getMonth()],
    revenue: revenueMap.get(`${date.getFullYear()}-${date.getMonth() + 1}`) || 0,
  }));
};

exports.getPlanDistribution = async () => {
  const rows = await OrganizationSubscription.aggregate([
    {
      $match: {
        status: "active",
      },
    },
    {
      $group: {
        _id: "$planSnapshot.name",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1, _id: 1 },
    },
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return rows.map((row) => ({
    name: row._id || "Unknown Plan",
    value: total > 0 ? Math.round((row.count / total) * 100) : 0,
  }));
};

exports.getRecentPayments = async () => {
  const payments = await SubscriptionPayment.find({ status: "success" })
    .sort({ paymentDate: -1, createdAt: -1 })
    .limit(10)
    .lean();

  const organizationIds = [...new Set(payments.map((payment) => payment.organizationId).filter(Boolean))];
  const organizations = await Organization.find({
    organizationId: { $in: organizationIds },
  })
    .select("organizationId name")
    .lean();

  const organizationMap = new Map(
    organizations.map((organization) => [organization.organizationId, organization.name]),
  );

  return payments.map((payment) => ({
    _id: String(payment._id),
    organizationName: organizationMap.get(payment.organizationId) || payment.organizationId || "Unknown Organization",
    amount: payment.amount || 0,
    date: payment.paymentDate
      ? new Date(payment.paymentDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-",
    status: payment.status,
  }));
};
