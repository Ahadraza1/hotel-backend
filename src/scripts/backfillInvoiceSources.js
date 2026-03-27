const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Invoice = require("../modules/invoice/invoice.model");
const POSOrder = require("../modules/pos/posOrder.model");
const Booking = require("../modules/booking/booking.model");

async function backfillInvoiceSources() {
  await connectDB();

  const posOrders = await POSOrder.find({
    invoiceId: { $nin: [null, ""] },
  })
    .select("invoiceId orderId bookingId")
    .lean();

  const posInvoiceIds = posOrders.map((order) => order.invoiceId).filter(Boolean);

  let posUpdates = 0;
  if (posOrders.length) {
    const posOps = posOrders.map((order) => ({
      updateOne: {
        filter: { invoiceId: order.invoiceId },
        update: {
          $set: {
            referenceType: "POS",
            referenceId: order.orderId,
          },
        },
      },
    }));

    const posResult = await Invoice.bulkWrite(posOps, { ordered: false });
    posUpdates = (posResult.modifiedCount || 0) + (posResult.upsertedCount || 0);
  }

  const bookingInvoices = await Invoice.find({
    bookingId: { $ne: null },
    ...(posInvoiceIds.length ? { invoiceId: { $nin: posInvoiceIds } } : {}),
  })
    .select("_id bookingId")
    .lean();

  const bookingObjectIds = bookingInvoices
    .map((invoice) => invoice.bookingId)
    .filter((bookingId) => mongoose.Types.ObjectId.isValid(bookingId))
    .map((bookingId) => new mongoose.Types.ObjectId(bookingId));

  const bookings = bookingObjectIds.length
    ? await Booking.find({ _id: { $in: bookingObjectIds } })
        .select("_id bookingId")
        .lean()
    : [];

  const bookingIdMap = new Map(
    bookings.map((booking) => [booking._id.toString(), booking.bookingId]),
  );

  let bookingUpdates = 0;
  if (bookingInvoices.length) {
    const bookingOps = bookingInvoices.map((invoice) => ({
      updateOne: {
        filter: { _id: invoice._id },
        update: {
          $set: {
            referenceType: "BOOKING",
            ...(bookingIdMap.get(String(invoice.bookingId))
              ? { referenceId: bookingIdMap.get(String(invoice.bookingId)) }
              : {}),
          },
        },
      },
    }));

    const bookingResult = await Invoice.bulkWrite(bookingOps, { ordered: false });
    bookingUpdates = (bookingResult.modifiedCount || 0) + (bookingResult.upsertedCount || 0);
  }

  const unresolvedInvoices = await Invoice.find({
    $or: [
      { referenceType: { $exists: false } },
      { referenceType: null },
      { referenceType: { $nin: ["BOOKING", "POS"] } },
    ],
  })
    .select("invoiceId bookingId referenceType referenceId createdAt")
    .lean();

  console.log("Invoice source backfill complete");
  console.log(`POS-linked invoices updated: ${posUpdates}`);
  console.log(`Booking-linked invoices updated: ${bookingUpdates}`);
  console.log(`Unresolved invoices remaining: ${unresolvedInvoices.length}`);

  if (unresolvedInvoices.length) {
    unresolvedInvoices.slice(0, 20).forEach((invoice) => {
      console.log(
        JSON.stringify({
          invoiceId: invoice.invoiceId,
          bookingId: invoice.bookingId,
          referenceType: invoice.referenceType || null,
          referenceId: invoice.referenceId || null,
          createdAt: invoice.createdAt,
        }),
      );
    });
  }
}

backfillInvoiceSources()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Failed to backfill invoice sources:", error);
    await mongoose.disconnect();
    process.exit(1);
  });
