const Branch = require("../branch/branch.model");
const Room = require("../room/room.model");
const RoomType = require("./roomType.model");
const RoomPricing = require("../roomPricing/roomPricing.model");

const normalizeRoomTypeName = (value = "") => String(value || "").trim();

const normalizeRoomTypeKey = (value = "") =>
  normalizeRoomTypeName(value).toLowerCase();

const requireRoomAccess = (user, permission = "VIEW_ROOM") => {
  if (user?.isPlatformAdmin) return;

  if (
    user?.role === "SUPER_ADMIN" ||
    user?.role === "CORPORATE_ADMIN" ||
    user?.role === "BRANCH_MANAGER"
  ) {
    return;
  }

  if (!user?.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

const getActiveBranchForUser = async (user) => {
  if (!user?.branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  const branch = await Branch.findById(user.branchId);

  if (!branch) {
    const error = new Error("Branch not found");
    error.statusCode = 404;
    throw error;
  }

  return branch;
};

const syncRoomTypesFromRooms = async ({ branchId, organizationId, userId }) => {
  const existingNames = (
    await Room.find({
      branchId,
      isActive: { $ne: false },
      roomType: { $exists: true, $ne: null },
    })
      .distinct("roomType")
  )
    .map(normalizeRoomTypeName)
    .filter(Boolean);

  if (!existingNames.length) {
    return RoomType.find({ branchId }).sort({ name: 1 });
  }

  const existingTypes = await RoomType.find({ branchId });
  const roomTypeByKey = new Map(
    existingTypes.map((type) => [type.normalizedName, type]),
  );

  const missingTypes = existingNames
    .map((name) => ({
      name,
      normalizedName: normalizeRoomTypeKey(name),
    }))
    .filter((type) => type.normalizedName && !roomTypeByKey.has(type.normalizedName));

  if (missingTypes.length) {
    const createdTypes = await RoomType.insertMany(
      missingTypes.map((type) => ({
        organizationId,
        branchId,
        name: type.name,
        normalizedName: type.normalizedName,
        createdBy: userId,
      })),
      { ordered: false },
    ).catch(() => []);

    createdTypes.forEach((type) => {
      roomTypeByKey.set(type.normalizedName, type);
    });
  }

  const freshTypes =
    roomTypeByKey.size === existingTypes.length
      ? existingTypes
      : await RoomType.find({ branchId });

  const bulkUpdates = freshTypes
    .map((type) => ({
      updateMany: {
        filter: {
          branchId,
          roomType: type.name,
          $or: [
            { roomTypeId: { $exists: false } },
            { roomTypeId: null },
          ],
        },
        update: { $set: { roomTypeId: type._id } },
      },
    }))
    .filter(Boolean);

  if (bulkUpdates.length) {
    await Room.bulkWrite(bulkUpdates, { ordered: false }).catch(() => null);
  }

  return RoomType.find({ branchId }).sort({ name: 1 });
};

const getRoomTypeByIdOrName = async ({
  branchId,
  organizationId,
  roomTypeId,
  roomTypeName,
  userId,
}) => {
  if (roomTypeId) {
    const roomType = await RoomType.findOne({ _id: roomTypeId, branchId });

    if (!roomType) {
      const error = new Error("Room type not found");
      error.statusCode = 404;
      throw error;
    }

    return roomType;
  }

  const normalizedName = normalizeRoomTypeKey(roomTypeName);

  if (!normalizedName) {
    const error = new Error("Room type is required");
    error.statusCode = 400;
    throw error;
  }

  let roomType = await RoomType.findOne({ branchId, normalizedName });

  if (!roomType) {
    roomType = await RoomType.create({
      organizationId,
      branchId,
      name: normalizeRoomTypeName(roomTypeName),
      normalizedName,
      createdBy: userId,
    });
  }

  return roomType;
};

exports.listRoomTypes = async (user) => {
  requireRoomAccess(user, "VIEW_ROOM");

  const branch = await getActiveBranchForUser(user);

  return syncRoomTypesFromRooms({
    branchId: branch._id,
    organizationId: branch.organizationId,
    userId: user._id,
  });
};

exports.createRoomType = async (data, user) => {
  requireRoomAccess(user, "CREATE_ROOM");

  const branch = await getActiveBranchForUser(user);
  const name = normalizeRoomTypeName(data?.name);
  const description = String(data?.description || "").trim();

  if (!name) {
    const error = new Error("Room type name is required");
    error.statusCode = 400;
    throw error;
  }

  const normalizedName = normalizeRoomTypeKey(name);

  const existing = await RoomType.findOne({
    branchId: branch._id,
    normalizedName,
  });

  if (existing) {
    existing.description = description || existing.description || "";
    existing.updatedBy = user._id;
    await existing.save();
    return existing;
  }

  return RoomType.create({
    organizationId: branch.organizationId,
    branchId: branch._id,
    name,
    normalizedName,
    description,
    createdBy: user._id,
  });
};

exports.updateRoomType = async (roomTypeId, data, user) => {
  requireRoomAccess(user, "UPDATE_ROOM");

  const branch = await getActiveBranchForUser(user);
  const roomType = await RoomType.findOne({ _id: roomTypeId, branchId: branch._id });

  if (!roomType) {
    const error = new Error("Room type not found");
    error.statusCode = 404;
    throw error;
  }

  const nextName = normalizeRoomTypeName(data?.name || roomType.name);
  const nextDescription = String(data?.description || "").trim();

  if (!nextName) {
    const error = new Error("Room type name is required");
    error.statusCode = 400;
    throw error;
  }

  const nextNormalizedName = normalizeRoomTypeKey(nextName);
  const duplicate = await RoomType.findOne({
    branchId: branch._id,
    normalizedName: nextNormalizedName,
    _id: { $ne: roomType._id },
  });

  if (duplicate) {
    const error = new Error("Room type name already exists");
    error.statusCode = 409;
    throw error;
  }

  const previousName = roomType.name;
  roomType.name = nextName;
  roomType.normalizedName = nextNormalizedName;
  roomType.description = nextDescription;
  roomType.updatedBy = user._id;
  await roomType.save();

  if (previousName !== nextName) {
    await Room.updateMany(
      {
        branchId: branch._id,
        roomTypeId: roomType._id,
      },
      {
        $set: {
          roomType: nextName,
        },
      },
    );
  }

  return roomType;
};

exports.deleteRoomType = async (roomTypeId, user) => {
  requireRoomAccess(user, "UPDATE_ROOM");

  const branch = await getActiveBranchForUser(user);
  const roomType = await RoomType.findOne({ _id: roomTypeId, branchId: branch._id });

  if (!roomType) {
    const error = new Error("Room type not found");
    error.statusCode = 404;
    throw error;
  }

  const linkedRoomsCount = await Room.countDocuments({
    branchId: branch._id,
    roomTypeId: roomType._id,
  });

  if (linkedRoomsCount > 0) {
    const error = new Error("Cannot delete a room type that is assigned to rooms");
    error.statusCode = 409;
    throw error;
  }

  await RoomPricing.deleteMany({
    branchId: branch._id,
    roomTypeId: roomType._id,
  });

  await RoomType.deleteOne({ _id: roomType._id });

  return roomType;
};

exports.resolveRoomType = async ({ roomTypeId, roomTypeName, user }) => {
  const branch = await getActiveBranchForUser(user);

  return getRoomTypeByIdOrName({
    branchId: branch._id,
    organizationId: branch.organizationId,
    roomTypeId,
    roomTypeName,
    userId: user._id,
  });
};

exports.resolveRoomTypeForBranch = getRoomTypeByIdOrName;
exports.normalizeRoomTypeKey = normalizeRoomTypeKey;
