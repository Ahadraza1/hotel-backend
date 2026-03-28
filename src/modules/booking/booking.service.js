const Booking = require("./booking.model");
const Room = require("../room/room.model");
const Invoice = require("../invoice/invoice.model");
const Branch = require("../branch/branch.model");
const guestService = require("../crm/guest.service");
const branchSettingsService = require("../branchSettings/branchSettings.service");
const notificationService = require("../notification/notification.service");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const { ensureActiveBranch } = require("../../utils/workspaceScope");

/*
  Permission Helper
*/
const requirePermission = (user, permission) => {
  if (user.isPlatformAdmin) return;

  if (
    user.role === "SUPER_ADMIN" ||
    user.role === "CORPORATE_ADMIN" ||
    user.role === "BRANCH_MANAGER"
  ) {
    return;
  }

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

const VALID_BOOKING_SOURCES = ["Walk-in", "Pre-booking", "Online"];
const VALID_PAYMENT_METHODS = ["CASH", "CARD", "UPI"];

const normalizeGuests = (guests) =>
  Array.isArray(guests)
    ? guests.map((guest) => ({
        name: guest?.name || "",
        email: guest?.email || "",
        phone: guest?.phone || "",
      }))
    : [];

const normalizeBookingSource = (bookingSource) =>
  VALID_BOOKING_SOURCES.includes(bookingSource) ? bookingSource : "Walk-in";

const normalizeServiceInput = (service) => {
  const name = String(service?.name || "").trim();
  const price = Number(service?.price || 0);
  const quantity = Number(service?.quantity || service?.qty || 1);

  if (!name) {
    throw new Error("Service name is required");
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Service price must be a valid number");
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Service quantity must be at least 1");
  }

  return {
    name,
    price,
    quantity,
    total: Number((price * quantity).toFixed(2)),
    updatedAt: new Date(),
  };
};

const calculateBookingAmounts = ({
  nights,
  roomPricePerNight,
  services = [],
  taxPercentage = 0,
}) => {
  const roomCharges = Number((Number(nights || 0) * Number(roomPricePerNight || 0)).toFixed(2));
  const serviceCharges = Number(
    services
      .reduce((sum, service) => sum + Number(service?.total || 0), 0)
      .toFixed(2),
  );
  const taxableBase = roomCharges + serviceCharges;
  const taxAmount = Number(((taxableBase * Number(taxPercentage || 0)) / 100).toFixed(2));
  const finalAmount = Number((taxableBase + taxAmount).toFixed(2));

  return {
    roomCharges,
    serviceCharges,
    taxAmount,
    finalAmount,
  };
};

const buildInvoiceLineItems = ({ booking, roomCharges, services }) => {
  const lineItems = [];

  if (roomCharges > 0) {
    lineItems.push({
      description: "Room Charges",
      quantity: booking.nights,
      unitPrice: booking.nights > 0 ? roomCharges / booking.nights : roomCharges,
      total: roomCharges,
    });
  }

  services.forEach((service) => {
    lineItems.push({
      description: service.name,
      quantity: service.quantity,
      unitPrice: service.price,
      total: service.total,
    });
  });

  return lineItems;
};

const ensureBookingRoomAvailability = async ({
  session,
  bookingId,
  roomId,
  user,
  checkInDate,
  checkOutDate,
}) => {
  const room = await Room.findById(roomId).session(session);

  if (!room || !room.isActive) {
    throw new Error("Room not found or inactive");
  }

  if (room.branchId.toString() !== user.branchId) {
    throw new Error("Room does not belong to active branch");
  }

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  if (checkOut <= checkIn) {
    throw new Error("Invalid date selection");
  }

  const overlapQuery = {
    roomId: room._id,
    status: { $ne: "CANCELLED" },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn },
  };

  if (bookingId) {
    overlapQuery.bookingId = { $ne: bookingId };
  }

  const overlapping = await Booking.find(overlapQuery).session(session);

  if (overlapping.length > 0) {
    throw new Error("Room already booked for selected dates");
  }

  return { room, checkIn, checkOut };
};

const createOrSyncBookingInvoice = async ({ booking, user, session }) => {
  const room =
    booking.roomId?.pricePerNight !== undefined
      ? booking.roomId
      : await Room.findById(booking.roomId).session(session);

  if (!room) {
    throw new Error("Room not found for invoice generation");
  }

  const financialSettings =
    await branchSettingsService.getFinancialSettingsByBranchId(booking.branchId);
  const amounts = calculateBookingAmounts({
    nights: booking.nights,
    roomPricePerNight: room.pricePerNight,
    services: booking.services || [],
    taxPercentage: financialSettings.taxPercentage,
  });

  const lineItems = buildInvoiceLineItems({
    booking,
    roomCharges: amounts.roomCharges,
    services: booking.services || [],
  });

  let invoice = await Invoice.findOne({
    bookingId: booking._id,
    referenceType: "BOOKING",
    isActive: true,
  }).session(session);

  const paidAmount = Number(invoice?.paidAmount || 0);
  const dueAmount = Number(Math.max(amounts.finalAmount - paidAmount, 0).toFixed(2));
  const invoiceStatus =
    dueAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIALLY_PAID" : "UNPAID";

  const invoicePayload = {
    organizationId: booking.organizationId,
    branchId: booking.branchId,
    bookingId: booking._id,
    type: "ROOM",
    referenceType: "BOOKING",
    referenceId: booking.bookingId,
    lineItems,
    totalAmount: amounts.roomCharges + amounts.serviceCharges,
    taxAmount: amounts.taxAmount,
    serviceChargeAmount: 0,
    discountAmount: 0,
    finalAmount: amounts.finalAmount,
    paidAmount,
    dueAmount,
    status: invoiceStatus,
    updatedBy: user.id || user.userId,
  };

  if (!invoice) {
    const created = await Invoice.create(
      [
        {
          ...invoicePayload,
          createdBy: user.id || user.userId,
        },
      ],
      { session },
    );
    invoice = created[0];
  } else {
    Object.assign(invoice, invoicePayload);
    await invoice.save({ session });
  }

  booking.invoiceId = invoice._id;
  booking.paidAmount = paidAmount;
  booking.paymentStatus =
    dueAmount === 0 ? "PAID" : paidAmount > 0 ? "PARTIAL" : "PENDING";

  return invoice;
};

const getBookingInvoice = async (bookingId) =>
  Invoice.findOne({
    bookingId,
    referenceType: "BOOKING",
    isActive: true,
  }).sort({ createdAt: -1 });

const serializeBooking = async (booking) => {
  const populatedBooking =
    booking.roomId?.roomNumber && booking.branchId?.name
      ? booking
      : await Booking.findById(booking._id || booking.id)
          .populate("roomId")
          .populate("branchId")
          .lean();

  const invoice =
    populatedBooking.invoiceId?.invoiceId !== undefined
      ? populatedBooking.invoiceId
      : await getBookingInvoice(populatedBooking._id);

  const room = populatedBooking.roomId || null;
  const branch = populatedBooking.branchId || null;
  const taxPercentage =
    invoice && invoice.finalAmount > 0
      ? Number(
          (
            (Number(invoice.taxAmount || 0) /
              Math.max(Number(invoice.totalAmount || 0), 1)) *
            100
          ).toFixed(2),
        )
      : Number(
          (
            await branchSettingsService.getFinancialSettingsByBranchId(
              populatedBooking.branchId?._id || populatedBooking.branchId,
            )
          ).taxPercentage || 0,
        );

  return {
    ...populatedBooking,
    room: room
      ? {
          _id: room._id,
          roomId: room.roomId,
          roomNumber: room.roomNumber,
          roomType: room.roomType,
          floor: room.floor,
          pricePerNight: room.pricePerNight,
        }
      : null,
    branch: branch
      ? {
          _id: branch._id,
          branchId: branch.branchId,
          name: branch.name,
          location: branch.address || branch.country || "",
          address: branch.address || "",
        }
      : null,
    invoice: invoice
      ? {
          _id: invoice._id,
          invoiceId: invoice.invoiceId,
          status: invoice.status,
          totalAmount: invoice.totalAmount,
          taxAmount: invoice.taxAmount,
          finalAmount: invoice.finalAmount,
          paidAmount: invoice.paidAmount,
          dueAmount: invoice.dueAmount,
          pdfUrl: `/api/invoices/${invoice.invoiceId}/pdf`,
        }
      : null,
    financialSummary: {
      roomCharges: invoice?.lineItems?.find((item) => item.description === "Room Charges")?.total ||
        Number(populatedBooking.totalAmount || 0),
      serviceCharges: Number(
        (populatedBooking.services || [])
          .reduce((sum, service) => sum + Number(service?.total || 0), 0)
          .toFixed(2),
      ),
      taxAmount: Number(invoice?.taxAmount || 0),
      totalAmount: Number(invoice?.finalAmount || populatedBooking.totalAmount || 0),
      taxPercentage,
      paymentStatus: populatedBooking.paymentStatus,
      paymentMethod: populatedBooking.paymentMethod || null,
      paymentDate: populatedBooking.paymentDate || null,
    },
  };
};

const getScopedBooking = async (bookingId, user, session = null) => {
  const query = Booking.findOne({
    bookingId,
    branchId: user.branchId,
    isActive: true,
  });

  if (session) {
    query.session(session);
  }

  const booking = await query;

  if (!booking) {
    throw new Error("Booking not found");
  }

  return booking;
};

exports.createBooking = async (data, user) => {
  requirePermission(user, "CREATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      roomId,
      guestName,
      guestType,
      bookingSource,
      guestPhone,
      guestEmail,
      totalGuests,
      guests,
      identityDocument,
      mainGuestIdentity,
      guestsIdentity,
      checkInDate,
      checkInTime,
      checkOutDate,
      checkOutTime,
    } = data;
    const mainGuestIdentityUrl = mainGuestIdentity || identityDocument?.url || null;

    if (!roomId || !guestName || !guestType || !checkInDate || !checkOutDate) {
      throw new Error("Required fields are missing");
    }

    if (!user.branchId) {
      throw new Error("No active branch selected");
    }

    const branch = await Branch.findById(user.branchId).session(session);

    if (!branch) {
      throw new Error("Branch not found");
    }

    const { room, checkIn, checkOut } = await ensureBookingRoomAvailability({
      session,
      roomId,
      user,
      checkInDate,
      checkOutDate,
    });

    const nights =
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24);
    const roomCharges = nights * room.pricePerNight;

    const bookingArr = await Booking.create(
      [
        {
          bookingId: uuidv4(),
          organizationId: branch.organizationId,
          branchId: branch._id,
          roomId: room._id,
          guestName,
          guestType,
          bookingSource: normalizeBookingSource(bookingSource),
          guestPhone,
          guestEmail,
          totalGuests,
          identityDocument: identityDocument || null,
          mainGuestIdentity: mainGuestIdentityUrl,
          guestsIdentity: Array.isArray(guestsIdentity) ? guestsIdentity : [],
          guests: normalizeGuests(guests),
          checkInDate,
          checkInTime,
          checkOutDate,
          checkOutTime,
          nights,
          services: [],
          totalAmount: roomCharges,
          paidAmount: 0,
          paymentStatus: "PENDING",
          status: "CONFIRMED",
          createdBy: user.id || user.userId,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    const bookingData = bookingArr[0].toObject();
    bookingData.identityDocument = identityDocument || null;
    bookingData.mainGuestIdentity = mainGuestIdentityUrl;
    bookingData.guestsIdentity = guestsIdentity || [];

    await guestService.syncGuestFromBooking(bookingData, user);

    await notificationService.createNotificationSafely({
      title: "New booking created",
      message: `Booking ${bookingArr[0].bookingId} was created for ${guestName}.`,
      type: "booking",
      organizationId: branch.organizationId,
      branchId: branch._id,
      module: "BOOKING",
    });

    return bookingArr[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.getBookings = async (user) => {
  requirePermission(user, "VIEW_BOOKING");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  return Booking.find({
    branchId: user.branchId,
    isActive: true,
  }).sort({ createdAt: -1 });
};

exports.getBookingById = async (bookingId, user) => {
  requirePermission(user, "VIEW_BOOKING");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const booking = await Booking.findOne({
    bookingId,
    branchId: user.branchId,
    isActive: true,
  })
    .populate("roomId")
    .populate("branchId")
    .lean();

  if (!booking) {
    throw new Error("Booking not found");
  }

  return serializeBooking(booking);
};

exports.updateBooking = async (bookingId, data, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!(await ensureActiveBranch(user.branchId))) {
      throw new Error("Branch not found");
    }

    const booking = await getScopedBooking(bookingId, user, session);

    if (booking.status === "CHECKED_OUT") {
      throw new Error("Checked-out bookings cannot be updated");
    }

    const {
      roomId,
      guestName,
      guestType,
      bookingSource,
      guestPhone,
      guestEmail,
      totalGuests,
      guests,
      identityDocument,
      mainGuestIdentity,
      guestsIdentity,
      checkInDate,
      checkInTime,
      checkOutDate,
      checkOutTime,
    } = data;
    const mainGuestIdentityUrl = mainGuestIdentity || identityDocument?.url || null;

    if (!roomId || !guestName || !guestType || !checkInDate || !checkOutDate) {
      throw new Error("Required fields are missing");
    }

    const { room, checkIn, checkOut } = await ensureBookingRoomAvailability({
      session,
      bookingId,
      roomId,
      user,
      checkInDate,
      checkOutDate,
    });

    const nights =
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24);
    const roomCharges = nights * room.pricePerNight;

    booking.roomId = room._id;
    booking.guestName = guestName;
    booking.guestType = guestType;
    booking.bookingSource = normalizeBookingSource(bookingSource);
    booking.guestPhone = guestPhone;
    booking.guestEmail = guestEmail;
    booking.totalGuests = totalGuests;
    booking.guests = normalizeGuests(guests);
    booking.checkInDate = checkInDate;
    booking.checkInTime = checkInTime;
    booking.checkOutDate = checkOutDate;
    booking.checkOutTime = checkOutTime;
    booking.nights = nights;
    booking.totalAmount = roomCharges;
    booking.updatedBy = user.id || user.userId;

    if (identityDocument) {
      booking.identityDocument = identityDocument;
    }

    if (mainGuestIdentityUrl) {
      booking.mainGuestIdentity = mainGuestIdentityUrl;
    }

    if (guestsIdentity) {
      booking.guestsIdentity = guestsIdentity;
    }

    if (booking.status === "CHECKED_IN" || booking.invoiceId) {
      await createOrSyncBookingInvoice({ booking, user, session });
    }

    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    await notificationService.createNotificationSafely({
      title: "Booking updated",
      message: `Booking ${booking.bookingId} was updated.`,
      type: "booking",
      organizationId: booking.organizationId,
      branchId: booking.branchId,
      module: "BOOKING",
    });

    return booking;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.deleteBooking = async (bookingId, user) => {
  requirePermission(user, "DELETE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!(await ensureActiveBranch(user.branchId))) {
      throw new Error("Branch not found");
    }

    const booking = await Booking.findOne({
      bookingId,
      branchId: user.branchId,
    }).session(session);

    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.status === "CHECKED_IN") {
      await Room.findByIdAndUpdate(
        booking.roomId,
        { status: "AVAILABLE" },
        { session },
      );
    }

    await Booking.deleteOne({ _id: booking._id }).session(session);

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.updateBookingStatus = async (bookingId, status, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const allowedStatuses = [
    "CONFIRMED",
    "CHECKED_IN",
    "CHECKED_OUT",
    "CANCELLED",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid status");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!(await ensureActiveBranch(user.branchId))) {
      throw new Error("Branch not found");
    }

    const booking = await getScopedBooking(bookingId, user, session);

    if (status === "CHECKED_IN") {
      if (booking.status === "CHECKED_OUT") {
        throw new Error("Checked-out bookings cannot be checked in again");
      }

      booking.status = "CHECKED_IN";
      booking.actualCheckIn = booking.actualCheckIn || new Date();
      await Room.findByIdAndUpdate(
        booking.roomId,
        { status: "OCCUPIED" },
        { session },
      );
      await createOrSyncBookingInvoice({ booking, user, session });
    }

    if (status === "CHECKED_OUT") {
      if (booking.paymentStatus !== "PAID") {
        throw new Error("Payment must be completed before checkout.");
      }

      if (booking.status !== "CHECKED_IN") {
        throw new Error("Only checked-in bookings can be checked out");
      }

      booking.status = "CHECKED_OUT";
      booking.actualCheckOut = new Date();

      await Room.findByIdAndUpdate(
        booking.roomId,
        { status: "AVAILABLE" },
        { session },
      );
    }

    if (status === "CANCELLED") {
      if (booking.status === "CHECKED_OUT") {
        throw new Error("Checked-out bookings cannot be cancelled");
      }

      if (booking.status === "CHECKED_IN") {
        await Room.findByIdAndUpdate(
          booking.roomId,
          { status: "AVAILABLE" },
          { session },
        );
      }

      booking.status = "CANCELLED";
    }

    if (status === "CONFIRMED") {
      booking.status = "CONFIRMED";
    }

    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    return booking;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.addBookingService = async (bookingId, data, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await getScopedBooking(bookingId, user, session);

    if (booking.status !== "CHECKED_IN") {
      throw new Error("Services can only be added after check-in");
    }

    if (booking.paymentStatus === "PAID") {
      throw new Error("Paid bookings cannot be updated with new services");
    }

    const normalizedService = normalizeServiceInput(data);
    booking.services.push({
      ...normalizedService,
      createdAt: new Date(),
    });

    await createOrSyncBookingInvoice({ booking, user, session });
    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    return serializeBooking(booking);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.updateBookingService = async (bookingId, serviceId, data, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await getScopedBooking(bookingId, user, session);

    if (booking.status === "CHECKED_OUT") {
      throw new Error("Checked-out bookings cannot be edited");
    }

    if (booking.paymentStatus === "PAID") {
      throw new Error("Paid bookings cannot be updated");
    }

    const service = booking.services.id(serviceId);

    if (!service) {
      throw new Error("Service not found");
    }

    const normalizedService = normalizeServiceInput(data);
    service.name = normalizedService.name;
    service.price = normalizedService.price;
    service.quantity = normalizedService.quantity;
    service.total = normalizedService.total;
    service.updatedAt = new Date();

    if (booking.status === "CHECKED_IN" || booking.invoiceId) {
      await createOrSyncBookingInvoice({ booking, user, session });
    }

    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    return serializeBooking(booking);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.removeBookingService = async (bookingId, serviceId, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await getScopedBooking(bookingId, user, session);

    if (booking.status === "CHECKED_OUT") {
      throw new Error("Checked-out bookings cannot be edited");
    }

    if (booking.paymentStatus === "PAID") {
      throw new Error("Paid bookings cannot be updated");
    }

    const service = booking.services.id(serviceId);

    if (!service) {
      throw new Error("Service not found");
    }

    service.deleteOne();

    if (booking.status === "CHECKED_IN" || booking.invoiceId) {
      await createOrSyncBookingInvoice({ booking, user, session });
    }

    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    return serializeBooking(booking);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.processBookingPayment = async (bookingId, method, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  if (!VALID_PAYMENT_METHODS.includes(method)) {
    throw new Error("Invalid payment method");
  }

  const booking = await getScopedBooking(bookingId, user);

  if (booking.status !== "CHECKED_IN") {
    throw new Error("Payment can only be processed for checked-in bookings");
  }

  let invoice = await getBookingInvoice(booking._id);

  if (!invoice) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const scopedBooking = await getScopedBooking(bookingId, user, session);
      invoice = await createOrSyncBookingInvoice({
        booking: scopedBooking,
        user,
        session,
      });
      await scopedBooking.save({ session });
      await session.commitTransaction();
      session.endSession();
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  const invoiceService = require("../invoice/invoice.service");
  const dueAmount = Number(invoice.dueAmount || 0);

  if (dueAmount <= 0) {
    booking.paymentStatus = "PAID";
    booking.paymentMethod = method;
    booking.paymentDate = booking.paymentDate || new Date();
    booking.invoiceId = booking.invoiceId || invoice._id;
    await booking.save();
    return serializeBooking(booking);
  }

  await invoiceService.recordPayment(
    invoice.invoiceId,
    { amount: dueAmount, method },
    user,
  );

  const refreshedBooking = await Booking.findById(booking._id);
  refreshedBooking.paymentStatus = "PAID";
  refreshedBooking.paymentMethod = method;
  refreshedBooking.paymentDate = new Date();
  refreshedBooking.invoiceId = refreshedBooking.invoiceId || invoice._id;
  await refreshedBooking.save();

  return serializeBooking(refreshedBooking);
};

exports.generateBookingInvoice = async (bookingId, user) => {
  requirePermission(user, "VIEW_BOOKING");

  const booking = await getScopedBooking(bookingId, user);
  let invoice = await getBookingInvoice(booking._id);

  if (!invoice) {
    if (booking.status !== "CHECKED_IN" && booking.status !== "CHECKED_OUT") {
      throw new Error("Invoice is available after check-in");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const scopedBooking = await getScopedBooking(bookingId, user, session);
      invoice = await createOrSyncBookingInvoice({
        booking: scopedBooking,
        user,
        session,
      });
      await scopedBooking.save({ session });
      await session.commitTransaction();
      session.endSession();
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  return {
    invoiceId: invoice.invoiceId,
    pdfUrl: `/api/invoices/${invoice.invoiceId}/pdf`,
  };
};
