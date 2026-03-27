const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const payrollSchema = new mongoose.Schema(
  {
    payrollId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    organizationId: {
      type: String,
      required: true,
      index: true,
    },

    branchId: {
      type: String,
      required: true,
      index: true,
    },

    staffId: {
      type: String,
      required: true,
      index: true,
    },

    month: {
      type: Number, // 1-12
      required: true,
    },

    year: {
      type: Number,
      required: true,
    },

    baseSalary: {
      type: Number,
      required: true,
    },

    overtimePay: {
      type: Number,
      default: 0,
    },

    leaveDeduction: {
      type: Number,
      default: 0,
    },

    bonus: {
      type: Number,
      default: 0,
    },

    grossSalary: {
      type: Number,
      required: true,
    },

    netSalary: {
      type: Number,
      required: true,
    },

    totalWorkingDays: {
      type: Number,
      default: 0,
    },

    totalPresentDays: {
      type: Number,
      default: 0,
    },

    totalOvertimeHours: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["UNPAID", "PAID"],
      default: "UNPAID",
      index: true,
    },

    paidAt: {
      type: Date,
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

/*
  Prevent duplicate payroll for same staff/month/year
*/
payrollSchema.index(
  { staffId: 1, month: 1, year: 1 },
  { unique: true }
);

module.exports = mongoose.model("Payroll", payrollSchema);