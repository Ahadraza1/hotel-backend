const guestService = require("./guest.service");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");

/*
  Create Guest
*/
exports.createGuest = asyncHandler(async (req, res) => {

  const guest = await guestService.createGuest(
    req.body,
    req.user
  );

  return res.status(201).json({
    success: true,
    message: "Guest created successfully",
    data: guest,
  });
});


/*
  Get Guests (CRM List)
*/
exports.getGuests = asyncHandler(async (req, res) => {

  const { branchId } = req.query;

  const guests = await guestService.getGuests(
    req.user,
    branchId
  );

  // enrich CRM data
  const formattedGuests = guests.map(g => ({
    guestId: g.guestId,
    firstName: g.firstName,
    lastName: g.lastName,
    email: g.email,
    phone: g.phone,

    loyaltyPoints: g.loyaltyPoints,
    vipStatus: g.vipStatus,
    blacklisted: g.blacklisted,

    totalStays: g.totalStays || 0,
    totalGuests: g.totalGuests || 0,
    totalSpent: g.totalSpent || 0,
    currentStatus: g.currentStatus || "—",
  }));

  return res.status(200).json({
    success: true,
    count: formattedGuests.length,
    data: formattedGuests,
  });
});


/*
  Update Guest
*/
exports.updateGuest = asyncHandler(async (req, res) => {

  const { guestId } = req.params;

  const updatedGuest = await guestService.updateGuest(
    guestId,
    req.body,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Guest updated successfully",
    data: updatedGuest,
  });
});


/*
  Toggle VIP
*/
exports.toggleVIP = asyncHandler(async (req, res) => {

  const { guestId } = req.params;

  const guest = await guestService.toggleVIP(
    guestId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "VIP status updated",
    data: guest,
  });
});


/*
  Toggle Blacklist
*/
exports.toggleBlacklist = asyncHandler(async (req, res) => {

  const { guestId } = req.params;

  const guest = await guestService.toggleBlacklist(
    guestId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Blacklist status updated",
    data: guest,
  });
});


/*
  Get Guest Profile (Full CRM Profile)
*/
exports.getGuestProfile = asyncHandler(async (req, res) => {

  const { guestId } = req.params;

  const profile = await guestService.getGuestProfile(
    guestId,
    req.user
  );

  return res.status(200).json({
    success: true,
    data: profile,
  });
});