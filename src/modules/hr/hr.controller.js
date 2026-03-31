const hrService = require("./hr.service");
const asyncHandler = require("../../utils/asyncHandler");

/* ===========================
   STAFF CONTROLLERS
=========================== */

exports.createStaff = asyncHandler(async (req, res) => {

  const staff = await hrService.createStaff(
    req.body,
    req.user
  );

  return res.status(201).json({
    success: true,
    message: "Staff created successfully",
    data: staff,
  });
});


exports.getStaff = asyncHandler(async (req, res) => {

  const { branchId } = req.query;

  const staffList = await hrService.getStaff(
    req.user,
    branchId
  );

  return res.status(200).json({
    success: true,
    count: staffList.length,
    data: staffList,
  });
});

exports.getAssignableRoles = asyncHandler(async (req, res) => {
  const roles = await hrService.getAssignableRoles(req.user);

  return res.status(200).json({
    success: true,
    count: roles.length,
    data: roles,
  });
});

exports.updateStaff = asyncHandler(async (req, res) => {
  const { staffId } = req.params;

  const staff = await hrService.updateStaff(staffId, req.body, req.user);

  return res.status(200).json({
    success: true,
    message: "Staff updated successfully",
    data: staff,
  });
});

exports.deleteStaff = asyncHandler(async (req, res) => {
  const { staffId } = req.params;

  const result = await hrService.deleteStaff(staffId, req.user);

  return res.status(200).json({
    success: true,
    message: result.message,
  });
});


/* ===========================
   ATTENDANCE CONTROLLERS
=========================== */

exports.checkIn = asyncHandler(async (req, res) => {

  const staffId = req.params.staffId;
  const branchId = req.body.branch || req.get("x-branch-id");

  console.log("StaffId:", staffId);
  console.log("BranchId:", branchId);

  if (!branchId) {
    return res.status(400).json({
      status: "fail",
      message: "Branch is required",
    });
  }

  const attendance = await hrService.checkIn(
    staffId,
    branchId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Check-in successful",
    data: attendance,
  });
});


exports.checkOut = asyncHandler(async (req, res) => {

  const staffId = req.params.staffId;
  const branchId = req.body.branch || req.get("x-branch-id");

  console.log("StaffId:", staffId);
  console.log("BranchId:", branchId);

  if (!branchId) {
    return res.status(400).json({
      status: "fail",
      message: "Branch is required",
    });
  }

  const attendance = await hrService.checkOut(
    staffId,
    branchId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Check-out successful",
    data: attendance,
  });
});


/* ===========================
   PAYROLL CONTROLLERS
=========================== */

exports.generatePayroll = asyncHandler(async (req, res) => {

  const staffId = req.params.staffId;
  const branchId = req.body.branch || req.get("x-branch-id");
  const { month, year } = req.body;

  console.log("StaffId:", staffId);
  console.log("BranchId:", branchId);

  if (!branchId) {
    return res.status(400).json({
      status: "fail",
      message: "Branch is required",
    });
  }

  const payroll = await hrService.generatePayroll(
    staffId,
    branchId,
    month,
    year,
    req.user
  );

  return res.status(201).json({
    success: true,
    message: "Payroll generated successfully",
    data: payroll,
  });
});


exports.markPayrollPaid = asyncHandler(async (req, res) => {

  const { payrollId } = req.params;

  const payroll = await hrService.markPayrollPaid(
    payrollId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Payroll marked as paid",
    data: payroll,
  });
});

exports.getPayroll = asyncHandler(async (req, res) => {

  const { branchId } = req.query;

  const payrollList = await hrService.getPayroll(
    req.user,
    branchId
  );

  return res.status(200).json({
    success: true,
    count: payrollList.length,
    data: payrollList,
  });
});

exports.updatePayroll = asyncHandler(async (req, res) => {
  const { payrollId } = req.params;

  const payroll = await hrService.updatePayroll(payrollId, req.body, req.user);

  return res.status(200).json({
    success: true,
    message: "Payroll updated successfully",
    data: payroll,
  });
});

exports.deletePayroll = asyncHandler(async (req, res) => {
  const { payrollId } = req.params;

  const result = await hrService.deletePayroll(payrollId, req.user);

  return res.status(200).json({
    success: true,
    message: result.message,
  });
});
