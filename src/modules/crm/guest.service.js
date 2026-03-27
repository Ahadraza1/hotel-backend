const Guest = require("./guest.model");
const Booking = require("../booking/booking.model");
const Invoice = require("../invoice/invoice.model");
const Branch = require("../branch/branch.model");

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

  const guest = await Guest.findOne({
    guestId,
    branchId: user.branchId,
  });

  if (!guest) {
    throw new Error("Guest not found");
  }

  const bookings = await Booking.find({
    branchId: user.branchId,
    guestEmail: guest.email,
  }).sort({ createdAt: -1 });

  const invoices = await Invoice.find({
    branchId: user.branchId,
  });

  const totalSpent = invoices.reduce(
    (sum, inv) => sum + (inv.paidAmount || 0),
    0,
  );

  const loyaltyPoints = Math.floor(totalSpent / 100);

  return {
    guest,
    bookings,
    totalSpent,
    loyaltyPoints,
  };
};

/*
  Sync Guest CRM after Booking
*/
exports.syncGuestFromBooking = async (booking, user) => {

  if (!booking.guestEmail && !booking.guestPhone) return;

  let guest = await Guest.findOne({
    branchId: booking.branchId,
    $or: [
      { email: booking.guestEmail },
      { phone: booking.guestPhone }
    ]
  });

  // Create guest if not exist
  if (!guest) {

    const nameParts = (booking.guestName || "").split(" ");

    guest = await Guest.create({
      organizationId: booking.organizationId,
      branchId: booking.branchId,
      firstName: nameParts[0] || "Guest",
      lastName: nameParts.slice(1).join(" "),
      email: booking.guestEmail,
      phone: booking.guestPhone,
      createdBy: user.id || user.userId,
    });

  }

  // Update CRM stats
  guest.totalStays += 1;
  guest.totalGuests += booking.totalGuests || 1;
  guest.totalSpent += booking.totalAmount || 0;

  guest.lastStay = booking.checkOutDate;
  guest.currentStatus = booking.status;

  // Save documents
  if (booking.mainGuestIdentity) {
    guest.documents.push(booking.mainGuestIdentity);
  }

  if (booking.guestsIdentity?.length) {
    guest.documents.push(...booking.guestsIdentity);
  }

  // Booking history
  guest.bookingHistory.push({
    bookingId: booking.bookingId,
    roomId: booking.roomId,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    totalAmount: booking.totalAmount,
    status: booking.status,
  });

  await guest.save();

  return guest;
};
