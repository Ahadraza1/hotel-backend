const Branch = require("../branch/branch.model");
const RoomPricing = require("./roomPricing.model");
const RoomType = require("../roomType/roomType.model");
const roomTypeService = require("../roomType/roomType.service");
const { buildDateKeys, buildStayDateKeys, normalizeDateKey } = require("./pricing.util");

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

const getBranchForUser = async (user) => {
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

const buildPricingMap = (pricingDocuments = []) =>
  pricingDocuments.reduce((acc, item) => {
    acc[`${item.roomTypeId.toString()}::${item.date}`] = Number(item.price || 0);
    return acc;
  }, {});

const getRoomTypeLookupForBranch = async (branchId) => {
  const roomTypes = await RoomType.find({ branchId }).select("_id name normalizedName");
  const byName = new Map(roomTypes.map((type) => [type.normalizedName, type]));
  const byId = new Map(roomTypes.map((type) => [type._id.toString(), type]));

  return { roomTypes, byName, byId };
};

const resolveRoomTypeRef = async ({ room, branchId, session = null }) => {
  if (room?.roomTypeId) {
    return room.roomTypeId.toString();
  }

  const query = RoomType.findOne({
    branchId,
    normalizedName: roomTypeService.normalizeRoomTypeKey(room?.roomType),
  }).select("_id");

  if (session) {
    query.session(session);
  }

  const roomType = await query;
  return roomType?._id?.toString() || null;
};

const buildAppliedPrices = ({ dateKeys, pricingMap, roomTypeId, fallbackPrice }) =>
  dateKeys.map((dateKey) => Number(pricingMap[`${roomTypeId}::${dateKey}`] ?? fallbackPrice ?? 0));

exports.listRoomPrices = async ({ user, startDate, endDate }) => {
  requireRoomAccess(user, "VIEW_ROOM");

  const branch = await getBranchForUser(user);
  await roomTypeService.listRoomTypes(user);

  const startDateKey = normalizeDateKey(startDate);
  const endDateKey = normalizeDateKey(endDate);

  if (!startDateKey || !endDateKey) {
    const error = new Error("Valid startDate and endDate are required");
    error.statusCode = 400;
    throw error;
  }

  const prices = await RoomPricing.find({
    branchId: branch._id,
    date: { $gte: startDateKey, $lte: endDateKey },
  }).sort({ date: 1 });

  return prices;
};

exports.upsertRoomPrice = async ({ user, roomTypeId, date, price }) => {
  requireRoomAccess(user, "UPDATE_ROOM");

  const branch = await getBranchForUser(user);
  const normalizedDate = normalizeDateKey(date);
  const normalizedPrice = Number(price);

  if (!roomTypeId || !normalizedDate || !Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
    const error = new Error("roomTypeId, date, and a valid price are required");
    error.statusCode = 400;
    throw error;
  }

  const roomType = await roomTypeService.resolveRoomTypeForBranch({
    branchId: branch._id,
    organizationId: branch.organizationId,
    roomTypeId,
    userId: user._id,
  });

  return RoomPricing.findOneAndUpdate(
    {
      branchId: branch._id,
      roomTypeId: roomType._id,
      date: normalizedDate,
    },
    {
      $set: {
        organizationId: branch.organizationId,
        price: normalizedPrice,
        updatedBy: user._id,
      },
      $setOnInsert: {
        createdBy: user._id,
      },
    },
    {
      new: true,
      upsert: true,
    },
  );
};

exports.bulkUpsertRoomPrices = async ({ user, updates = [] }) => {
  requireRoomAccess(user, "UPDATE_ROOM");

  const branch = await getBranchForUser(user);

  if (!Array.isArray(updates) || !updates.length) {
    const error = new Error("At least one price update is required");
    error.statusCode = 400;
    throw error;
  }

  const uniqueRoomTypeIds = [...new Set(updates.map((item) => String(item?.roomTypeId || "")).filter(Boolean))];
  const roomTypes = await RoomType.find({
    branchId: branch._id,
    _id: { $in: uniqueRoomTypeIds },
  }).select("_id");
  const roomTypeIdSet = new Set(roomTypes.map((type) => type._id.toString()));

  const operations = updates.map((item) => {
    const normalizedDate = normalizeDateKey(item?.date);
    const normalizedPrice = Number(item?.price);
    const normalizedRoomTypeId = String(item?.roomTypeId || "");

    if (
      !normalizedDate ||
      !roomTypeIdSet.has(normalizedRoomTypeId) ||
      !Number.isFinite(normalizedPrice) ||
      normalizedPrice < 0
    ) {
      return null;
    }

    return {
      updateOne: {
        filter: {
          branchId: branch._id,
          roomTypeId: normalizedRoomTypeId,
          date: normalizedDate,
        },
        update: {
          $set: {
            organizationId: branch.organizationId,
            price: normalizedPrice,
            updatedBy: user._id,
          },
          $setOnInsert: {
            createdBy: user._id,
          },
        },
        upsert: true,
      },
    };
  }).filter(Boolean);

  if (!operations.length) {
    const error = new Error("No valid price updates were provided");
    error.statusCode = 400;
    throw error;
  }

  await RoomPricing.bulkWrite(operations, { ordered: false });

  return RoomPricing.find({
    branchId: branch._id,
    roomTypeId: { $in: uniqueRoomTypeIds },
    date: { $in: [...new Set(operations.map((operation) => operation.updateOne.filter.date))] },
  });
};

exports.applyPricingToRooms = async ({
  rooms = [],
  branchId,
  checkInDate,
  checkOutDate,
}) => {
  if (!rooms.length) {
    return rooms;
  }

  const dateKeys =
    checkInDate && checkOutDate
      ? buildStayDateKeys({ checkInDate, checkOutDate })
      : buildDateKeys({
          startDate: checkInDate || new Date(),
          endDate: checkInDate || new Date(),
        });

  if (!dateKeys.length) {
    return rooms;
  }

  const { byName } = await getRoomTypeLookupForBranch(branchId);
  const roomTypeIds = [
    ...new Set(
      rooms
        .map((room) =>
          room.roomTypeId?.toString() ||
          byName.get(roomTypeService.normalizeRoomTypeKey(room.roomType))?._id?.toString(),
        )
        .filter(Boolean),
    ),
  ];

  if (!roomTypeIds.length) {
    return rooms;
  }

  const pricingDocuments = await RoomPricing.find({
    branchId,
    roomTypeId: { $in: roomTypeIds },
    date: { $in: dateKeys },
  }).select("roomTypeId date price");

  const pricingMap = buildPricingMap(pricingDocuments);

  return rooms.map((room) => {
    const roomTypeId =
      room.roomTypeId?.toString() ||
      byName.get(roomTypeService.normalizeRoomTypeKey(room.roomType))?._id?.toString();

    if (!roomTypeId) {
      return room;
    }

    const appliedPrices = buildAppliedPrices({
      dateKeys,
      pricingMap,
      roomTypeId,
      fallbackPrice: room.pricePerNight,
    });

    const totalPrice = appliedPrices.reduce((sum, value) => sum + value, 0);
    const averageNightlyRate = appliedPrices.length
      ? Number((totalPrice / appliedPrices.length).toFixed(2))
      : Number(room.pricePerNight || 0);

    return {
      ...room,
      pricePerNight: averageNightlyRate,
      pricingSummary: {
        nights: appliedPrices.length,
        totalPrice: Number(totalPrice.toFixed(2)),
        averageNightlyRate,
        dates: dateKeys,
      },
    };
  });
};

exports.calculateStayPricingForRoom = async ({
  room,
  branchId,
  checkInDate,
  checkOutDate,
  session = null,
}) => {
  const dateKeys =
    checkInDate && checkOutDate
      ? buildStayDateKeys({ checkInDate, checkOutDate })
      : buildDateKeys({
          startDate: checkInDate || new Date(),
          endDate: checkInDate || new Date(),
        });

  if (!dateKeys.length) {
    return {
      nights: 0,
      averageNightlyRate: Number(room?.pricePerNight || 0),
      totalPrice: 0,
      dates: [],
    };
  }

  const roomTypeId = await resolveRoomTypeRef({ room, branchId, session });

  if (!roomTypeId) {
    return {
      nights: dateKeys.length,
      averageNightlyRate: Number(room?.pricePerNight || 0),
      totalPrice: Number((Number(room?.pricePerNight || 0) * dateKeys.length).toFixed(2)),
      dates: dateKeys,
    };
  }

  const query = RoomPricing.find({
    branchId,
    roomTypeId,
    date: { $in: dateKeys },
  }).select("roomTypeId date price");

  if (session) {
    query.session(session);
  }

  const pricingDocuments = await query;
  const pricingMap = buildPricingMap(pricingDocuments);
  const appliedPrices = buildAppliedPrices({
    dateKeys,
    pricingMap,
    roomTypeId,
    fallbackPrice: room?.pricePerNight,
  });
  const totalPrice = appliedPrices.reduce((sum, value) => sum + value, 0);
  const averageNightlyRate = appliedPrices.length
    ? Number((totalPrice / appliedPrices.length).toFixed(2))
    : Number(room?.pricePerNight || 0);

  return {
    nights: dateKeys.length,
    averageNightlyRate,
    totalPrice: Number(totalPrice.toFixed(2)),
    dates: dateKeys,
  };
};
