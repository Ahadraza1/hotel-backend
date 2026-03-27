const housekeepingService = require("./housekeeping.service");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");

/*
  Create Task
*/
exports.createTask = asyncHandler(async (req, res) => {

  const task = await housekeepingService.createTask(
    req.body,
    req.user
  );

  return res.status(201).json({
    success: true,
    message: "Housekeeping task created successfully",
    data: task,
  });
});


/*
  Get Tasks
*/
exports.getTasks = asyncHandler(async (req, res) => {

  const tasks = await housekeepingService.getTasks(req.user);

  return res.status(200).json({
    success: true,
    count: tasks.length,
    data: tasks,
  });
});


/*
  Assign Task
*/
exports.assignTask = asyncHandler(async (req, res) => {

  const { taskId } = req.params;
  const { assignedTo } = req.body;

  if (!assignedTo) {
    throw new AppError("Assigned user is required", 400);
  }

  const updatedTask = await housekeepingService.assignTask(
    taskId,
    assignedTo,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Task assigned successfully",
    data: updatedTask,
  });
});


/*
  Update Status
*/
exports.updateStatus = asyncHandler(async (req, res) => {

  const { taskId } = req.params;
  const { status } = req.body;

  if (!status) {
    throw new AppError("Status is required", 400);
  }

  const updatedTask = await housekeepingService.updateStatus(
    taskId,
    status,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Status updated successfully",
    data: updatedTask,
  });
});


/*
  Deactivate Task
*/
exports.deactivateTask = asyncHandler(async (req, res) => {

  const { taskId } = req.params;

  const task = await housekeepingService.deactivateTask(
    taskId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Task deactivated successfully",
    data: task,
  });
});