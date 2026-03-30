const Staff = require("./staff.model");
const Attendance = require("./attendance.model");
const Payroll = require("./payroll.model");
const mongoose = require("mongoose");
const User = require("../user/user.model");
const notificationService = require("../notification/notification.service");
const { ensureActiveBranch } = require("../../utils/workspaceScope");

/*
  Permission Helper
*/
const requirePermission = (user, permission) => {

  // ✅ SUPER ADMIN FULL ACCESS
  if (user.isPlatformAdmin || user.role === "SUPER_ADMIN") return;

  // ✅ CORPORATE ADMIN FULL BRANCH WORKSPACE ACCESS
  if (user.role === "CORPORATE_ADMIN") return;

  // ✅ BRANCH MANAGER FULL BRANCH WORKSPACE ACCESS
  if (user.role === "BRANCH_MANAGER") return;

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

/* ===========================
   STAFF
=========================== */

const Branch = require("../branch/branch.model");

const buildBranchIdFilter = (branchId) => {
  const values = [branchId];

  if (mongoose.Types.ObjectId.isValid(branchId)) {
    values.push(new mongoose.Types.ObjectId(branchId));
  }

  return { $in: values };
};

const buildStaffLookupQuery = (staffIdentifier, branchId) => {
  const query = {
    $or: [{ staffId: staffIdentifier }],
  };

  if (mongoose.Types.ObjectId.isValid(staffIdentifier)) {
    query.$or.push({ _id: new mongoose.Types.ObjectId(staffIdentifier) });
  }

  if (branchId) {
    query.branchId = buildBranchIdFilter(branchId);
  }

  return query;
};

const getCanonicalStaffIdentifier = (staff) =>
  staff?.staffId || staff?._id?.toString();

const normalizeBranchId = (branchId) => branchId?.toString?.() || null;

const isSameBranch = (leftBranchId, rightBranchId) =>
  normalizeBranchId(leftBranchId) === normalizeBranchId(rightBranchId);

const normalizeName = (value = "") =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeSalary = (salary) => {
  const parsedSalary = Number(salary);
  return Number.isFinite(parsedSalary) ? parsedSalary : 0;
};

const findLinkedStaffForUser = async (user, branchId) => {
  if (!user?._id && !user?.email && !user?.name) {
    return null;
  }

  const branchFilter = buildBranchIdFilter(branchId);
  const normalizedEmail = user.email?.trim().toLowerCase();
  const normalizedName = normalizeName(user.name);
  const orFilters = [{ createdBy: user._id }];

  if (normalizedEmail) {
    orFilters.push({ email: normalizedEmail });
  }

  let linkedStaff = await Staff.findOne({
    branchId: branchFilter,
    isActive: true,
    $or: orFilters,
  }).sort({ createdAt: -1 });

  if (!linkedStaff && normalizedName) {
    const staffCandidates = await Staff.find({
      branchId: branchFilter,
      isActive: true,
    }).select("firstName lastName salary department designation email createdBy");

    linkedStaff = staffCandidates.find(
      (staffMember) =>
        normalizeName(
          `${staffMember.firstName || ""} ${staffMember.lastName || ""}`,
        ) === normalizedName,
    );
  }

  return linkedStaff || null;
};

const resolveStaffByIdentifier = async (staffIdentifier, branchId) => {
  console.log("StaffId:", staffIdentifier);
  console.log("BranchId:", branchId);

  const normalizedBranchId = normalizeBranchId(branchId);

  const staff = await Staff.findOne(buildStaffLookupQuery(staffIdentifier));

  if (staff && isSameBranch(staff.branchId, normalizedBranchId)) {
    console.log("Staff Found:", staff);
    return staff;
  }

  const user = mongoose.Types.ObjectId.isValid(staffIdentifier)
    ? await User.findById(staffIdentifier).select(
        "_id name email role organizationId branchId isActive",
      )
    : null;

  if (user && user.isActive && isSameBranch(user.branchId, normalizedBranchId)) {
    const linkedStaff = await findLinkedStaffForUser(user, normalizedBranchId);

    const resolvedUserStaff = {
      _id: user._id,
      staffId: linkedStaff?.staffId || user._id.toString(),
      organizationId: linkedStaff?.organizationId || user.organizationId,
      branchId: normalizeBranchId(linkedStaff?.branchId || user.branchId),
      shiftStart: linkedStaff?.shiftStart || null,
      overtimeRatePerHour: linkedStaff?.overtimeRatePerHour || 0,
      salary: linkedStaff?.salary ?? 0,
    };

    console.log("Staff Found:", resolvedUserStaff);
    return resolvedUserStaff;
  }

  if (staff) {
    const error = new Error("Staff does not belong to this branch");
    error.statusCode = 400;
    throw error;
  }

  if (user) {
    const error = new Error("Staff does not belong to this branch");
    error.statusCode = 400;
    throw error;
  }

  console.log("Staff Found:", null);
  return null;
};

exports.createStaff = async (data, user) => {
  requirePermission(user, "ACCESS_HR");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  const branch = await Branch.findById(user.branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  const firstName = data.firstName?.trim();
  const lastName = data.lastName?.trim() || "";

  if (!firstName) {
    const error = new Error("First name is required");
    error.statusCode = 400;
    throw error;
  }

  const staffPayload = {
    firstName,
    lastName,
    email: data.email?.trim()?.toLowerCase(),
    phone: data.phone?.trim(),
    department: data.department?.trim() || "MANAGEMENT",
    designation: data.designation?.trim() || data.role?.trim() || "STAFF",
    employmentType: data.employmentType,
    salary: normalizeSalary(data.salary),
    overtimeRatePerHour: data.overtimeRatePerHour,
    shiftStart: data.shiftStart,
    shiftEnd: data.shiftEnd,
    leaveBalance: data.leaveBalance,
    performanceRating: data.performanceRating,
    joiningDate: data.joiningDate || new Date(),
    organizationId: branch.organizationId?.toString(),
    branchId: branch._id.toString(),
    createdBy: user.id || user.userId || user._id,
  };

  const staff = await Staff.create({
    ...staffPayload,
  });

  await notificationService.createNotificationSafely({
    title: "Staff member added",
    message: `A new staff member was added to branch ${branch.name}.`,
    type: "hr",
    organizationId: branch.organizationId,
    branchId: branch._id,
    module: "HR",
  });

  return staff;
};

// get staff
exports.getStaff = async (user, branchId) => {
  requirePermission(user, "ACCESS_HR");

  let branchFilter;

  // 🔥 AUTO BRANCH DETECTION
  if (user.role === "BRANCH_MANAGER") {
    if (!(await ensureActiveBranch(user.branchId))) {
      throw new Error("Branch not found");
    }
    branchFilter = buildBranchIdFilter(user.branchId);
  } 
  else if (branchId) {
    if (!(await ensureActiveBranch(branchId))) {
      throw new Error("Branch not found");
    }
    branchFilter = buildBranchIdFilter(branchId);
  } 
  else {
    throw new Error("BranchId is required");
  }

  // ✅ GET USERS (ALL INVITED USERS)
  const users = await User.find({
    branchId: branchFilter,
    isActive: true,
  }).select("name email role branchId");

  // ✅ GET STAFF (HR DATA)
  const staff = await Staff.find({
    branchId: branchFilter,
    isActive: true,
  }).select(
    "staffId firstName lastName department designation salary email branchId organizationId createdBy",
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const attendanceRecords = await Attendance.find({
    branchId: branchFilter,
    date: today,
    isActive: true,
  }).select("staffId checkInTime checkOutTime");

  const attendanceStatusMap = new Map();
  attendanceRecords.forEach((record) => {
    const resolvedStatus = record.checkOutTime ? "Checked Out" : "Checked In";
    attendanceStatusMap.set(record.staffId, resolvedStatus);
  });

  // 🔥 MAP STAFF BY EMAIL / USER LINK
  const staffByEmailMap = new Map();
  const staffByCreatorMap = new Map();
  const staffByNameMap = new Map();
  staff.forEach((s) => {
    if (s.email) {
      staffByEmailMap.set(s.email.trim().toLowerCase(), s);
    }

    if (s.createdBy) {
      staffByCreatorMap.set(s.createdBy.toString(), s);
    }

    const normalizedStaffName = normalizeName(
      `${s.firstName || ""} ${s.lastName || ""}`,
    );

    if (normalizedStaffName) {
      staffByNameMap.set(normalizedStaffName, s);
    }
  });

  // 🔥 MERGE USER + STAFF
  const matchedStaffIds = new Set();

  const userRows = users.map((u) => {
    const staffData =
      staffByCreatorMap.get(u._id.toString()) ||
      staffByEmailMap.get(u.email?.trim().toLowerCase()) ||
      staffByNameMap.get(normalizeName(u.name));

    if (staffData?._id) {
      matchedStaffIds.add(staffData._id.toString());
    }

    return {
      _id: u._id?.toString() || staffData?._id?.toString(),
      staffId: staffData?.staffId || u._id,

      firstName:
        staffData?.firstName || u.name?.split(" ")[0] || "—",

      lastName:
        staffData?.lastName ||
        u.name?.split(" ").slice(1).join(" ") ||
        "",

      department: staffData?.department || "—",

      designation: staffData?.designation || u.role,

      salary: staffData?.salary ?? 0,
      attendanceStatus:
        attendanceStatusMap.get(staffData?.staffId || u._id.toString()) || "—",

      email: u.email,
    };
  });

  const standaloneStaffRows = staff
    .filter((staffMember) => !matchedStaffIds.has(staffMember._id.toString()))
    .map((staffMember) => ({
      _id: staffMember._id.toString(),
      staffId: staffMember.staffId,
      firstName: staffMember.firstName || "—",
      lastName: staffMember.lastName || "",
      department: staffMember.department || "—",
      designation: staffMember.designation || "—",
      salary: staffMember.salary ?? 0,
      attendanceStatus: attendanceStatusMap.get(staffMember.staffId) || "—",
      email: staffMember.email,
    }));

  return [...userRows, ...standaloneStaffRows];
};

exports.updateStaff = async (staffId, data, user) => {
  requirePermission(user, "ACCESS_HR");

  const staff = await Staff.findOne(
    buildStaffLookupQuery(staffId, user.branchId || data.branchId),
  );

  if (!staff || !staff.isActive) {
    const error = new Error("Staff not found");
    error.statusCode = 404;
    throw error;
  }

  const allowedUpdates = [
    "firstName",
    "lastName",
    "department",
    "designation",
    "salary",
  ];

  allowedUpdates.forEach((field) => {
    if (data[field] !== undefined) {
      staff[field] = data[field];
    }
  });

  await staff.save();

  return staff;
};

exports.deleteStaff = async (staffId, user) => {
  requirePermission(user, "ACCESS_HR");

  const staff = await Staff.findOne(
    buildStaffLookupQuery(staffId, user.branchId),
  );

  if (!staff || !staff.isActive) {
    const error = new Error("Staff not found");
    error.statusCode = 404;
    throw error;
  }

  staff.isActive = false;
  await staff.save();

  return { message: "Staff deleted successfully" };
};

/* ===========================
   ATTENDANCE
=========================== */

exports.checkIn = async (staffId, branchId, user) => {
  requirePermission(user, "ACCESS_HR");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!branchId) {
    const error = new Error("Branch is required");
    error.statusCode = 400;
    throw error;
  }

  if (!(await ensureActiveBranch(branchId))) {
    throw new Error("Branch not found");
  }

  const staff = await resolveStaffByIdentifier(staffId, branchId);

  if (!staff) {
    const error = new Error("Staff not found");
    error.statusCode = 404;
    throw error;
  }

  const resolvedStaffId = getCanonicalStaffIdentifier(staff);

  const existing = await Attendance.findOne({
    staffId: resolvedStaffId,
    branchId: buildBranchIdFilter(branchId),
    date: today,
  });

  if (existing) {
    const error = new Error("Already checked in today");
    error.statusCode = 400;
    throw error;
  }

  const checkInTime = new Date();

  // Late detection
  let isLate = false;
  if (staff.shiftStart) {
    const [hour, minute] = staff.shiftStart.split(":");
    const shiftTime = new Date();
    shiftTime.setHours(hour, minute, 0, 0);

    if (checkInTime > shiftTime) {
      isLate = true;
    }
  }

  const attendance = await Attendance.create({
    organizationId: staff.organizationId,
    branchId: staff.branchId,
    staffId: resolvedStaffId,
    date: today,
    checkInTime,
    isLate,
    createdBy: user.id || user.userId,
  });

  await notificationService.createNotificationSafely({
    title: "Staff check-in recorded",
    message: `A check-in was recorded for staff ${resolvedStaffId}.`,
    type: "hr",
    organizationId: staff.organizationId,
    branchId: staff.branchId,
    module: "HR",
  });

  return attendance;
};

exports.checkOut = async (staffId, branchId, user) => {
  requirePermission(user, "ACCESS_HR");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!branchId) {
    const error = new Error("Branch is required");
    error.statusCode = 400;
    throw error;
  }

  if (!(await ensureActiveBranch(branchId))) {
    throw new Error("Branch not found");
  }

  const staff = await resolveStaffByIdentifier(staffId, branchId);

  if (!staff) {
    const error = new Error("Staff not found");
    error.statusCode = 404;
    throw error;
  }

  const resolvedStaffId = getCanonicalStaffIdentifier(staff);

  const attendance = await Attendance.findOne({
    staffId: resolvedStaffId,
    branchId: buildBranchIdFilter(branchId),
    date: today,
  });

  if (!attendance) {
    const error = new Error("Check-in not found");
    error.statusCode = 404;
    throw error;
  }

  if (attendance.checkOutTime) {
    const error = new Error("Already checked out");
    error.statusCode = 400;
    throw error;
  }

  const checkOutTime = new Date();
  attendance.checkOutTime = checkOutTime;

  const hoursWorked =
    (checkOutTime - attendance.checkInTime) / (1000 * 60 * 60);

  attendance.totalHours = Number(hoursWorked.toFixed(2));

  // Overtime (> 8 hours)
  if (hoursWorked > 8) {
    attendance.overtimeHours = Number((hoursWorked - 8).toFixed(2));
  }

  await attendance.save();

  return attendance;
};

/* ===========================
   PAYROLL
=========================== */

exports.generatePayroll = async (staffId, branchId, month, year, user) => {
  requirePermission(user, "ACCESS_HR");

  if (!branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  if (!(await ensureActiveBranch(branchId))) {
    throw new Error("Branch not found");
  }

  const staff = await resolveStaffByIdentifier(staffId, branchId);

  if (!staff) {
    const error = new Error("Staff not found");
    error.statusCode = 404;
    throw error;
  }

  const resolvedStaffId = getCanonicalStaffIdentifier(staff);

  const existing = await Payroll.findOne({
    staffId: resolvedStaffId,
    month,
    year,
    branchId: buildBranchIdFilter(branchId),
  });

  if (existing) {
    const error = new Error("Payroll already generated");
    error.statusCode = 400;
    throw error;
  }

  const attendances = await Attendance.find({
    staffId: resolvedStaffId,
    branchId: buildBranchIdFilter(branchId),
    date: {
      $gte: new Date(year, month - 1, 1),
      $lte: new Date(year, month, 0),
    },
  });

  if (!attendances.length) {
    const error = new Error("No attendance found");
    error.statusCode = 400;
    throw error;
  }

  const totalPresentDays = attendances.length;
  const totalOvertimeHours = attendances.reduce(
    (sum, a) => sum + (a.overtimeHours || 0),
    0,
  );

  const overtimePay = totalOvertimeHours * (staff.overtimeRatePerHour || 0);

  const grossSalary = staff.salary + overtimePay;
  const netSalary = grossSalary;

  const payroll = await Payroll.create({
    organizationId: staff.organizationId,
    branchId: staff.branchId,
    staffId: resolvedStaffId,
    month,
    year,
    baseSalary: staff.salary,
    overtimePay,
    grossSalary,
    netSalary,
    totalWorkingDays: 30,
    totalPresentDays,
    totalOvertimeHours,
    generatedBy: user.id || user.userId,
  });

  await notificationService.createNotificationSafely({
    title: "Payroll generated",
    message: `Payroll was generated for staff ${resolvedStaffId} for ${month}/${year}.`,
    type: "hr",
    organizationId: staff.organizationId,
    branchId: staff.branchId,
    module: "HR",
  });

  return payroll;
};

exports.markPayrollPaid = async (payrollId, user) => {
  requirePermission(user, "ACCESS_HR");

  const payroll = await Payroll.findOne({ payrollId });

  if (!payroll) {
    throw new Error("Payroll not found");
  }

  payroll.status = "PAID";
  payroll.paidAt = new Date();

  await payroll.save();

  return payroll;
};

exports.getPayroll = async (user, branchId) => {
  requirePermission(user, "ACCESS_HR");

  if (!branchId) {
    throw new Error("BranchId is required");
  }

  if (!(await ensureActiveBranch(branchId))) {
    throw new Error("Branch not found");
  }

  return await Payroll.find({
    branchId: buildBranchIdFilter(branchId),
    isActive: true,
  }).sort({ createdAt: -1 });
};

exports.updatePayroll = async (payrollId, data, user) => {
  requirePermission(user, "ACCESS_HR");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const payroll = await Payroll.findOne({
    payrollId,
    branchId: buildBranchIdFilter(user.branchId),
    isActive: true,
  });

  if (!payroll) {
    const error = new Error("Payroll not found");
    error.statusCode = 404;
    throw error;
  }

  const allowedUpdates = ["month", "year", "netSalary", "status"];

  allowedUpdates.forEach((field) => {
    if (data[field] !== undefined) {
      payroll[field] = data[field];
    }
  });

  if (data.status === "PAID") {
    payroll.paidAt = payroll.paidAt || new Date();
  }

  if (data.status === "UNPAID") {
    payroll.paidAt = undefined;
  }

  await payroll.save();

  return payroll;
};

exports.deletePayroll = async (payrollId, user) => {
  requirePermission(user, "ACCESS_HR");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const payroll = await Payroll.findOne({
    payrollId,
    branchId: buildBranchIdFilter(user.branchId),
    isActive: true,
  });

  if (!payroll) {
    const error = new Error("Payroll not found");
    error.statusCode = 404;
    throw error;
  }

  payroll.isActive = false;
  await payroll.save();

  return { message: "Payroll deleted successfully" };
};
