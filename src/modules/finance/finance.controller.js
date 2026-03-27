const financeService = require("./finance.service");
const Booking = require("../booking/booking.model");

/*
  Generate Invoice
*/
exports.generateInvoice = async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        message: "BookingId is required",
      });
    }

    const invoice = await financeService.generateInvoice(
      bookingId,
      req.user
    );

    res.status(201).json({
      message: "Invoice generated successfully",
      data: invoice,
    });

  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};


/*
  Record Payment
*/
exports.recordPayment = async (req, res) => {
  try {

    const payment = await financeService.recordPayment(
      req.body,
      req.user
    );

    const { bookingId, amount } = req.body;

    // 🔹 Update booking payment status
    if (bookingId && amount) {

      const booking = await Booking.findOne({ bookingId });

      if (booking) {

        booking.paidAmount += Number(amount);

        if (booking.paidAmount >= booking.totalAmount) {
          booking.paymentStatus = "PAID";
        } else if (booking.paidAmount > 0) {
          booking.paymentStatus = "PARTIAL";
        }

        await booking.save();
      }
    }

    res.status(201).json({
      message: "Payment recorded successfully",
      data: payment,
    });

  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};


/*
  Add Expense
*/
exports.addExpense = async (req, res) => {
  try {
    const expense = await financeService.addExpense(
      req.body,
      req.user
    );

    res.status(201).json({
      message: "Expense added successfully",
      data: expense,
    });

  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};


/*
  Get Revenue Summary
*/
exports.getRevenueSummary = async (req, res) => {
  try {
    const summary = await financeService.getRevenueSummary(
      req.user
    );

    res.status(200).json({
      data: summary,
    });

  } catch (error) {
    res.status(403).json({
      message: error.message,
    });
  }
};


