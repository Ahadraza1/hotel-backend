const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const branchSettingsSchema = new mongoose.Schema(
  {
    settingsId: {
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
      unique: true,
      index: true,
    },

    /* =========================
       GENERAL SETTINGS
    ========================== */
    general: {
      branchName: String,
      address: String,
      contactEmail: String,
      contactPhone: String,
      currency: {
        type: String,
        default: "USD",
      },
      timezone: {
        type: String,
        default: "UTC",
      },
      logoUrl: String,
      branchStatus: {
        type: String,
        enum: ["ACTIVE", "INACTIVE"],
        default: "ACTIVE",
      },
    },

    /* =========================
       FINANCIAL SETTINGS
    ========================== */
    financial: {
      defaultTaxPercentage: {
        type: Number,
        default: 0,
      },
      serviceChargePercentage: {
        type: Number,
        default: 0,
      },
      invoicePrefix: {
        type: String,
        default: "INV",
      },
      invoiceStartNumber: {
        type: Number,
        default: 1000,
      },
      enabledPaymentMethods: [
        {
          type: String,
          enum: ["CASH", "CARD", "UPI", "BANK_TRANSFER"],
        },
      ],
      refundApprovalRequired: {
        type: Boolean,
        default: true,
      },
    },

    /* =========================
       BOOKING POLICY
    ========================== */
    bookingPolicy: {
      checkInTime: {
        type: String,
        default: "14:00",
      },
      checkOutTime: {
        type: String,
        default: "11:00",
      },
      cancellationHoursLimit: {
        type: Number,
        default: 24,
      },
      autoCancelNoShow: {
        type: Boolean,
        default: true,
      },
      advancePaymentPercentage: {
        type: Number,
        default: 0,
      },
      allowOverbooking: {
        type: Boolean,
        default: false,
      },
    },

    /* =========================
       ROOM POLICY
    ========================== */
    roomPolicy: {
      damageDepositAmount: {
        type: Number,
        default: 0,
      },
      housekeepingAutoAssign: {
        type: Boolean,
        default: true,
      },
      maintenanceApprovalRequired: {
        type: Boolean,
        default: true,
      },
      autoResetRoomStatusOnCheckout: {
        type: Boolean,
        default: true,
      },
    },

    /* =========================
       HR SETTINGS
    ========================== */
    hrPolicy: {
      defaultShiftHours: {
        type: Number,
        default: 8,
      },
      overtimeThresholdHours: {
        type: Number,
        default: 8,
      },
      monthlyWorkingDays: {
        type: Number,
        default: 30,
      },
      payrollAutoGenerate: {
        type: Boolean,
        default: false,
      },
    },

    /* =========================
       INVENTORY SETTINGS
    ========================== */
    inventoryPolicy: {
      globalLowStockThreshold: {
        type: Number,
        default: 5,
      },
      autoPurchaseRequest: {
        type: Boolean,
        default: false,
      },
      approvalRequiredForStockRemoval: {
        type: Boolean,
        default: true,
      },
    },

    /* =========================
       SECURITY SETTINGS
    ========================== */
    securityPolicy: {
      require2FAForManagers: {
        type: Boolean,
        default: false,
      },
      auditLogRetentionDays: {
        type: Number,
        default: 90,
      },
      sessionTimeoutMinutes: {
        type: Number,
        default: 30,
      },
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BranchSettings", branchSettingsSchema);