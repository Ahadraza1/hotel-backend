const Housekeeping = require("./housekeeping.model");
const Room = require("../room/room.model");
const mongoose = require("mongoose");

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

/*
  Create Housekeeping Task
*/
exports.createTask = async (data, user) => {
  requirePermission(user, "ACCESS_HOUSEKEEPING");

  const { roomId, priority, notes, assignedTo } = data;

  if (!roomId) {
    throw new Error("Room is required");
  }

  const room = await Room.findById(roomId);

  if (!room) {
    throw new Error("Room not found");
  }

  // Branch isolation
  if (
    user.role === "BRANCH_MANAGER" &&
    room.branchId.toString() !== user.branchId.toString()
  ) {
    throw new Error("Access denied");
  }

  const task = await Housekeeping.create({
    organizationId: room.organizationId,
    branchId: room.branchId,
    roomId,
    priority,
    notes,
    assignedTo: assignedTo ? new mongoose.Types.ObjectId(assignedTo) : null,
    status: assignedTo ? "ASSIGNED" : "DIRTY",
    createdBy: user.id || user.userId,
  });

  // Mark room DIRTY
  await Room.findByIdAndUpdate(roomId, { status: "MAINTENANCE" });

  return task;
};

/*
  Get Tasks
*/
exports.getTasks = async (user) => {
  requirePermission(user, "ACCESS_HOUSEKEEPING");

  const filter = {
    isActive: true,
  };

  if (user.role === "HOUSEKEEPING") {
    // 🔍 DEBUG LOGS
    console.log("Housekeeping Fetch - User ID:", user.id || user._id);
    console.log("Housekeeping Fetch - Role:", user.role);
    
    // Housekeeping Staff: Only see tasks assigned to them AND in their branch
    filter.assignedTo = new mongoose.Types.ObjectId(user.id || user._id);
    if (user.branchId) {
      filter.branchId = user.branchId;
    }
  } else if (user.isPlatformAdmin || user.role === "SUPER_ADMIN") {
    // SuperAdmin: see all within current branch context if available
    if (user.branchId) {
      filter.branchId = user.branchId;
    }
  } else {
    // Branch-level admins: limit to their branch
    if (!user.branchId) {
      throw new Error("No active branch selected");
    }
    filter.branchId = user.branchId;
  }

  console.log("Housekeeping Filter Query:", JSON.stringify(filter));

  const tasks = await Housekeeping.find(filter)
    .populate("roomId", "roomNumber")
    .populate("assignedTo", "name") // Populate from User
    .sort({ createdAt: -1 });

  // Map to match frontend expectations (firstName/lastName) from User.name
  return tasks.map((t) => {
    const task = t.toObject();
    if (task.assignedTo && typeof task.assignedTo === "object" && task.assignedTo.name) {
      const names = task.assignedTo.name.trim().split(/\s+/);
      task.assignedTo.firstName = names[0] || "—";
      task.assignedTo.lastName = names.slice(1).join(" ") || "";
    }
    return task;
  });
};
/*
  Assign Staff
*/
exports.assignTask = async (taskId, assignedTo, user) => {
  requirePermission(user, "ACCESS_HOUSEKEEPING");

  const task = await Housekeeping.findOne({ housekeepingId: taskId });

  if (!task) {
    throw new Error("Task not found");
  }

  task.assignedTo = assignedTo ? new mongoose.Types.ObjectId(assignedTo) : null;
  task.status = "ASSIGNED";

  await task.save();

  return task;
};

/*
  Update Status
*/
exports.updateStatus = async (taskId, status, user) => {
  requirePermission(user, "ACCESS_HOUSEKEEPING");

  const allowedStatuses = [
    "DIRTY",
    "ASSIGNED",
    "IN_PROGRESS",
    "CLEAN",
    "INSPECTED",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid status");
  }

  const task = await Housekeeping.findOne({ housekeepingId: taskId });

  if (!task) {
    throw new Error("Task not found");
  }

  task.status = status;

  if (status === "CLEAN" || status === "INSPECTED") {
    task.completedAt = new Date();

    // Make room available again
    await Room.findByIdAndUpdate(task.roomId, {
      status: "AVAILABLE",
    });
  }

  await task.save();

  return task;
};

/*
  Soft Delete Task
*/
exports.deactivateTask = async (taskId, user) => {
  requirePermission(user, "ACCESS_HOUSEKEEPING");

  const task = await Housekeeping.findOne({ housekeepingId: taskId });

  if (!task) {
    throw new Error("Task not found");
  }

  task.isActive = false;
  await task.save();

  return task;
};