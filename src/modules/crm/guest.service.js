const Guest = require("./guest.model");
const Booking = require("../booking/booking.model");
const Branch = require("../branch/branch.model");
const { ensureActiveBranch } = require("../../utils/workspaceScope");

const normalizeValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeEmail = (value) => normalizeValue(value).toLowerCase();

const splitGuestName = (name = "") => {
  const cleanName = normalizeValue(name);
  const parts = cleanName.split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || "Guest",
    lastName: parts.slice(1).join(" "),
    fullName: cleanName,
  };
};

const uniqueValues = (...values) =>
  Array.from(new Set(values.filter(Boolean)));

const findGuestByUniqueContact = async (branchId, { email, phone }, excludeGuestId = null) => {
  const matches = [];

  if (email) {
    matches.push({ email });
  }

  if (phone) {
    matches.push({ phone });
  }

  if (!matches.length) {
    return null;
  }

  const query = {
    branchId,
    $or: matches,
  };

  if (excludeGuestId) {
    query._id = { $ne: excludeGuestId };
  }

  return Guest.findOne(query);
};

const getPrimaryGuestDocument = (booking) =>
  booking.identityProof?.url ||
  booking.identityDocument?.url ||
  booking.mainGuestIdentity ||
  null;

const getBookingGuests = (booking = {}) => {
  const primaryGuest = {
    name: booking.guestName,
    email: booking.guestEmail,
    phone: booking.guestPhone,
    role: "PRIMARY",
    documents: uniqueValues(getPrimaryGuestDocument(booking)),
  };

  const additionalGuests = Array.isArray(booking.guests)
    ? booking.guests.map((guest, index) => ({
        name: guest?.name,
        email: guest?.email,
        phone: guest?.phone,
        role: "ACCOMPANYING",
        documents: uniqueValues(booking.guestsIdentity?.[index] || null),
      }))
    : [];

  return [primaryGuest, ...additionalGuests].filter((guest) => {
    const details = [guest.name, guest.email, guest.phone]
      .map(normalizeValue)
      .filter(Boolean);
    return details.length > 0;
  });
};

const buildGuestLookupQuery = (branchId, guestData) => {
  const email = normalizeEmail(guestData.email);
  const phone = normalizeValue(guestData.phone);
  const { firstName, lastName, fullName } = splitGuestName(guestData.name);
  const identityMatches = [];

  if (email) {
    identityMatches.push({ email });
  }

  if (phone) {
    identityMatches.push({ phone });
  }

  if (!email && !phone && fullName) {
    identityMatches.push({ firstName, lastName });
  }

  if (identityMatches.length === 0) {
    return null;
  }

  return {
    branchId,
    $or: identityMatches,
  };
};

const upsertGuestFromBookingGuest = async (booking, bookingGuest, user) => {
  const query = buildGuestLookupQuery(booking.branchId, bookingGuest);

  if (!query) {
    return null;
  }

  const email = normalizeEmail(bookingGuest.email);
  const phone = normalizeValue(bookingGuest.phone);
  const { firstName, lastName } = splitGuestName(bookingGuest.name);

  let guest = await Guest.findOne(query);

  if (!guest) {
    try {
      guest = await Guest.create({
        organizationId: booking.organizationId,
        branchId: booking.branchId,
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        createdBy: user.id || user.userId,
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      guest =
        (await findGuestByUniqueContact(booking.branchId, { email, phone })) ||
        (await Guest.findOne(query));

      if (!guest) {
        return null;
      }
    }
  } else {
    if (!guest.firstName && firstName) {
      guest.firstName = firstName;
    }

    if (!guest.lastName && lastName) {
      guest.lastName = lastName;
    }

    if (!guest.email && email) {
      const emailOwner = await findGuestByUniqueContact(
        booking.branchId,
        { email, phone: "" },
        guest._id,
      );

      if (!emailOwner) {
        guest.email = email;
      }
    }

    if (!guest.phone && phone) {
      const phoneOwner = await findGuestByUniqueContact(
        booking.branchId,
        { email: "", phone },
        guest._id,
      );

      if (!phoneOwner) {
        guest.phone = phone;
      }
    }
  }

  if (!guest.organizationId && booking.organizationId) {
    guest.organizationId = booking.organizationId;
  }

  const bookingHistory = Array.isArray(guest.bookingHistory)
    ? guest.bookingHistory
    : [];
  const guestDocuments = Array.isArray(guest.documents) ? guest.documents : [];
  const bookingHistoryIndex = bookingHistory.findIndex(
    (entry) => entry.bookingId === booking.bookingId,
  );
  const bookingHistoryEntry = {
    bookingId: booking.bookingId,
    roomId: booking.roomId,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    totalAmount: booking.totalAmount,
    status: booking.status,
  };

  if (bookingHistoryIndex === -1) {
    guest.totalStays += 1;
    guest.totalGuests += bookingGuest.role === "PRIMARY" ? booking.totalGuests || 1 : 1;
    guest.totalSpent += booking.totalAmount || 0;
    bookingHistory.push(bookingHistoryEntry);
  } else {
    bookingHistory[bookingHistoryIndex] = {
      ...bookingHistory[bookingHistoryIndex].toObject(),
      ...bookingHistoryEntry,
    };
  }

  guest.bookingHistory = bookingHistory;

  if (
    !guest.lastStay ||
    new Date(booking.checkOutDate).getTime() >= new Date(guest.lastStay).getTime()
  ) {
    guest.lastStay = booking.checkOutDate;
    guest.currentStatus = booking.status;
  }

  guest.documents = uniqueValues(
    ...guestDocuments,
    ...(bookingGuest.documents || []),
  );

  try {
    await guest.save();
  } catch (error) {
    if (error.code === 11000) {
      return Guest.findOne(query);
    }

    throw error;
  }

  return guest;
};

const isBookingSyncable = (booking = {}, user = {}) => {
  if (!booking?.branchId || !booking?.organizationId) {
    return false;
  }

  return Boolean(user?.id || user?.userId);
};

const syncBookingGuestsSafely = async (booking, user) => {
  if (!isBookingSyncable(booking, user)) {
    return [];
  }

  try {
    return await exports.syncGuestFromBooking(booking, user);
  } catch (error) {
    return [];
  }
};

const syncGuestsFromActiveBookings = async (branchId, user) => {
  const bookings = await Booking.find({
    branchId,
    isActive: true,
  })
    .sort({ checkOutDate: 1, createdAt: 1 })
    .lean();

  for (const booking of bookings) {
    await syncBookingGuestsSafely(booking, user);
  }
};

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
  Create Guest
*/
exports.createGuest = async (data, user) => {
  requirePermission(user, "ACCESS_CRM");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  const branch = await Branch.findById(user.branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    nationality,
    idProofType,
    idProofNumber,
    dateOfBirth,
    notes,
  } = data;

  if (!firstName) {
    throw new Error("First name is required");
  }

  const guest = await Guest.create({
    organizationId: branch.organizationId, // ✅ derived from branch
    branchId: branch._id,
    firstName,
    lastName,
    email,
    phone,
    nationality,
    idProofType,
    idProofNumber,
    dateOfBirth,
    notes,
    createdBy: user.id || user.userId,
  });

  return guest;
};

/*
  Get Guests (Workspace Based)
*/
/*
  Get Guests (Workspace Based)
*/
exports.getGuests = async (user, branchId) => {
  requirePermission(user, "ACCESS_CRM");

  const activeBranchId = branchId || user.branchId;

  if (!activeBranchId) {
    throw new Error("No active branch selected");
  }

  if (!(await ensureActiveBranch(activeBranchId))) {
    throw new Error("Branch not found");
  }

  await syncGuestsFromActiveBookings(activeBranchId, user);

  return await Guest.find({
    branchId: activeBranchId,
    isActive: true,
  }).sort({ createdAt: -1 });
};

/*
  Update Guest
*/
exports.updateGuest = async (guestId, data, user) => {
  requirePermission(user, "ACCESS_CRM");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const guest = await Guest.findOne({
    guestId,
    branchId: user.branchId, // ✅ workspace isolation
  });

  if (!guest) {
    throw new Error("Guest not found");
  }

  Object.assign(guest, data);
  guest.updatedBy = user.id || user.userId;

  await guest.save();

  return guest;
};

/*
  Delete Guest
*/
exports.deleteGuest = async (guestId, user) => {
  requirePermission(user, "ACCESS_CRM");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const guest = await Guest.findOne({
    guestId,
    branchId: user.branchId,
    isActive: true,
  });

  if (!guest) {
    throw new Error("Guest not found");
  }

  guest.isActive = false;
  await guest.save();

  return { message: "Guest deleted successfully" };
};

/*
  Toggle VIP
*/
exports.toggleVIP = async (guestId, user) => {
  requirePermission(user, "ACCESS_CRM");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const guest = await Guest.findOne({
    guestId,
    branchId: user.branchId,
  });

  if (!guest) {
    throw new Error("Guest not found");
  }

  guest.vipStatus = !guest.vipStatus;
  await guest.save();

  return guest;
};

/*
  Blacklist Guest
*/
exports.toggleBlacklist = async (guestId, user) => {
  requirePermission(user, "ACCESS_CRM");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const guest = await Guest.findOne({
    guestId,
    branchId: user.branchId,
  });

  if (!guest) {
    throw new Error("Guest not found");
  }

  guest.blacklisted = !guest.blacklisted;
  await guest.save();

  return guest;
};

/*
  Get Guest Profile (Branch Isolated)
*/
exports.getGuestProfile = async (guestId, user) => {
  requirePermission(user, "ACCESS_CRM");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const guest = await Guest.findOne({
    guestId,
    branchId: user.branchId,
  }).lean();

  if (!guest) {
    throw new Error("Guest not found");
  }

  const bookingFilters = [];

  if (guest.email) {
    bookingFilters.push({ guestEmail: guest.email });
    bookingFilters.push({ "guests.email": guest.email });
  }

  if (guest.phone) {
    bookingFilters.push({ guestPhone: guest.phone });
    bookingFilters.push({ "guests.phone": guest.phone });
  }

  if (!guest.email && !guest.phone) {
    const fullName = [guest.firstName, guest.lastName].filter(Boolean).join(" ").trim();

    if (fullName) {
      bookingFilters.push({ guestName: fullName });
      bookingFilters.push({ "guests.name": fullName });
    }
  }

  let bookings = [];

  if (bookingFilters.length > 0 || guest.bookingHistory?.length) {
    const bookingQuery = {
      branchId: user.branchId,
      isActive: true,
    };

    if (bookingFilters.length > 0) {
      bookingQuery.$or = bookingFilters;
    } else {
      bookingQuery.bookingId = {
        $in: guest.bookingHistory.map((entry) => entry.bookingId).filter(Boolean),
      };
    }

    bookings = await Booking.find(bookingQuery)
      .populate("roomId", "roomNumber roomId")
      .sort({ createdAt: -1 })
      .lean();
  }

  const totalSpent = guest.totalSpent || 0;
  const loyaltyPoints = guest.loyaltyPoints || Math.floor(totalSpent / 100);
  const documents = Array.from(new Set((guest.documents || []).filter(Boolean)));

  return {
    guest: {
      ...guest,
      documents,
    },
    bookings,
    totalSpent,
    loyaltyPoints,
  };
};

/*
  Sync Guest CRM after Booking
*/
exports.syncGuestFromBooking = async (booking, user) => {
  const bookingGuests = getBookingGuests(booking);
  const syncedGuests = [];

  for (const bookingGuest of bookingGuests) {
    const syncedGuest = await upsertGuestFromBookingGuest(
      booking,
      bookingGuest,
      user,
    );

    if (syncedGuest) {
      syncedGuests.push(syncedGuest);
    }
  }

  return syncedGuests;
};
