const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { getSystemSettings } = require("../systemSettings/systemSettings.store");
const {
  DEFAULT_CURRENCY,
  formatAmount,
  formatCurrency,
} = require("../../utils/currency");

const formatDateTime = (value) => {
  if (!value) return "N/A";
  return new Date(value).toLocaleString();
};

const drawRoomInvoice = (
  doc,
  invoice,
  organization,
  branch,
  booking,
  financialSettings,
  currencyCode,
) => {
  // Theme Colors
  const primaryColor = "#111827";
  const accentColor = "#D4AF37";
  const textColor = "#374151";
  const lightText = "#6B7280";
  const borderColor = "#E5E7EB";
  const bgColor = "#F9FAFB";

  // Top Accent Bar
  doc.rect(0, 0, 595, 12).fill(accentColor);

  // Header Background
  doc.rect(0, 12, 595, 130).fill(primaryColor);

  // Invoice Title & ID
  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(28)
    .text("INVOICE", 0, 45, { align: "right", paddingRight: 40 });
  doc
    .fillColor("#9CA3AF")
    .font("Helvetica")
    .fontSize(10)
    .text(`ID: ${invoice.invoiceId}`, 0, 75, { align: "right" });

  // Organization Logo & Name
  const logoPath = organization.logoUrl
    ? path.join(__dirname, "../../", organization.logoUrl)
    : null;

  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 40, 35, { width: 60 });
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(26)
        .text(organization.name, 115, 45);
      doc
        .fillColor(accentColor)
        .font("Helvetica")
        .fontSize(12)
        .text(branch.name, 115, 75);
    } catch (err) {
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(28)
        .text(organization.name, 40, 45);
      doc
        .fillColor(accentColor)
        .font("Helvetica")
        .fontSize(12)
        .text(branch.name, 40, 75);
    }
  } else {
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(28)
      .text(organization.name, 40, 45);
    doc
      .fillColor(accentColor)
      .font("Helvetica")
      .fontSize(12)
      .text(branch.name, 40, 75);
  }

  let currentY = 142;
  doc.rect(0, currentY, 595, 50).fill(bgColor);

  const invoiceDate = new Date(
    invoice.createdAt || Date.now(),
  ).toLocaleDateString();

  doc
    .fillColor(lightText)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("DATE", 40, currentY + 12);
  doc
    .fillColor(textColor)
    .font("Helvetica")
    .fontSize(11)
    .text(invoiceDate, 40, currentY + 28);

  doc
    .fillColor(lightText)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("PROPERTY ADDRESS", 160, currentY + 12);
  doc
    .fillColor(textColor)
    .font("Helvetica")
    .fontSize(11)
    .text(branch.address || "N/A", 160, currentY + 28, {
      width: 250,
      lineBreak: false,
    });

  doc
    .fillColor(lightText)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("STATUS", 480, currentY + 12);
  const statusColor =
    invoice.status === "PAID"
      ? "#059669"
      : invoice.status === "PENDING"
        ? "#D97706"
        : "#DC2626";
  doc
    .fillColor(statusColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text((invoice.status || "UNKNOWN").toUpperCase(), 480, currentY + 26);

  currentY = 220;
  const guestName = invoice.guestName || booking?.guestName || "N/A";
  const roomNumber = booking?.roomId?.roomNumber || "N/A";
  const checkIn = booking?.checkInDate
    ? new Date(booking.checkInDate).toLocaleDateString()
    : "N/A";
  const checkOut = booking?.checkOutDate
    ? new Date(booking.checkOutDate).toLocaleDateString()
    : "N/A";

  doc
    .fillColor(accentColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("BILL TO", 40, currentY);
  doc.rect(40, currentY + 15, 200, 2).fill(accentColor);

  currentY += 28;
  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(guestName, 40, currentY);
  currentY += 22;
  doc.fillColor(textColor).font("Helvetica").fontSize(10);

  doc.text("Room Number:", 40, currentY);
  doc.font("Helvetica-Bold").text(roomNumber, 120, currentY);
  currentY += 15;
  doc.font("Helvetica").text("Check-In:", 40, currentY);
  doc.font("Helvetica-Bold").text(checkIn, 120, currentY);
  currentY += 15;
  doc.font("Helvetica").text("Check-Out:", 40, currentY);
  doc.font("Helvetica-Bold").text(checkOut, 120, currentY);

  currentY += 50;
  doc.rect(40, currentY, 515, 30).fill(primaryColor);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(10);
  doc.text("DESCRIPTION", 55, currentY + 10);
  doc.text("AMOUNT", 450, currentY + 10, { width: 90, align: "right" });

  currentY += 30;

  const drawRow = (desc, amount, isLast = false) => {
    doc.rect(40, currentY, 515, 35).fill(isLast ? "#FFFFFF" : bgColor);
    doc.fillColor(textColor).font("Helvetica").fontSize(11);
    doc.text(desc, 55, currentY + 12);
    doc.text(formatCurrency(amount, currencyCode), 450, currentY + 12, {
      width: 90,
      align: "right",
    });

    doc.rect(40, currentY + 34, 515, 1).fill(borderColor);
    currentY += 35;
  };

  const subTotal = formatAmount(invoice.totalAmount);
  const taxAmount = formatAmount(
    financialSettings
      ? (subTotal * Number(financialSettings.taxPercentage || 0)) / 100
      : invoice.taxAmount,
  );
  const serviceChargeAmount = formatAmount(
    financialSettings
      ? (subTotal * Number(financialSettings.serviceChargePercentage || 0)) / 100
      : invoice.serviceChargeAmount,
  );
  const discountAmount = formatAmount(invoice.discountAmount);

  drawRow("Room Charges", subTotal);
  drawRow("Tax & Fees", taxAmount);
  drawRow("Service Charge", serviceChargeAmount);
  drawRow("Discount", discountAmount);
  drawRow("Total Bill Amount", invoice.finalAmount);
  drawRow("Paid Amount", invoice.paidAmount);

  const due = formatAmount(invoice.dueAmount);
  doc.rect(40, currentY, 515, 40).fill(due > 0 ? "#FEF2F2" : "#ECFDF5");
  doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(12);
  doc.text("BALANCE DUE", 55, currentY + 14);
  doc
    .fillColor(due > 0 ? "#DC2626" : "#059669")
    .font("Helvetica-Bold")
    .fontSize(14);
  doc.text(formatCurrency(due, currencyCode), 450, currentY + 13, {
    width: 90,
    align: "right",
  });

  doc.rect(40, currentY + 39, 515, 2).fill(accentColor);
  currentY += 71;

  doc
    .fillColor(accentColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("PAYMENT HISTORY", 40, currentY);
  doc.rect(40, currentY + 15, 150, 2).fill(accentColor);
  currentY += 28;

  if (!invoice.paymentHistory || invoice.paymentHistory.length === 0) {
    doc
      .fillColor(lightText)
      .font("Helvetica")
      .fontSize(10)
      .text("No payments recorded for this invoice yet.", 40, currentY);
  } else {
    doc.fillColor(lightText).font("Helvetica-Bold").fontSize(9);
    doc.text("DATE & TIME", 45, currentY);
    doc.text("METHOD", 250, currentY);
    doc.text("AMOUNT", 450, currentY, { width: 90, align: "right" });

    currentY += 15;
    doc.rect(40, currentY, 515, 1).fill(borderColor);
    currentY += 8;

    invoice.paymentHistory.forEach((p) => {
      const date = new Date(p.paidAt || p.createdAt).toLocaleString();
      doc.fillColor(textColor).font("Helvetica").fontSize(10);
      doc.text(date, 45, currentY);
      doc.text(p.method || "CASH", 250, currentY);
      doc.text(formatCurrency(p.amount, currencyCode), 450, currentY, {
        width: 90,
        align: "right",
      });
      currentY += 18;
      doc.rect(40, currentY, 515, 1).fill(borderColor);
      currentY += 8;
    });
  }

  const pageBottom = 841.89;

  doc.rect(0, pageBottom - 70, 595, 1).fill(borderColor);
  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Thank you for choosing our hotel.", 0, pageBottom - 50, {
      align: "center",
    });
  doc
    .fillColor(lightText)
    .font("Helvetica")
    .fontSize(9)
    .text(
      "We hope to see you again. For any queries, please contact the front desk.",
      0,
      pageBottom - 35,
      { align: "center" },
    );

  doc.rect(0, pageBottom - 10, 595, 10).fill(accentColor);
};

const drawRestaurantInvoice = (
  doc,
  invoice,
  organization,
  branch,
  posOrder,
  posOrders,
  booking,
  financialSettings,
  currencyCode,
) => {
  const primaryColor = "#171717";
  const accentColor = "#C2410C";
  const accentSoft = "#FFF7ED";
  const textColor = "#262626";
  const mutedText = "#737373";
  const borderColor = "#E5E5E5";
  const tableHeaderBg = "#F5F5F4";
  const successBg = "#ECFDF3";
  const warningBg = "#FEF3C7";

  const orderTypeLabelMap = {
    DINE_IN: "Dine-in",
    TAKEAWAY: "Takeaway",
    DELIVERY: "Delivery",
    ROOM_SERVICE: "Room Service",
  };

  const sessionOrders = Array.isArray(posOrders) ? posOrders : [];
  const isSessionInvoice = Boolean(
    invoice.sessionId || (Array.isArray(invoice.orderIds) && invoice.orderIds.length > 1),
  );
  const items = (isSessionInvoice ? invoice.lineItems : posOrder?.items)?.map((item) => ({
      name: item.description || item.nameSnapshot || item.name || "Menu Item",
      quantity: Number(item.quantity || 0),
      price: formatAmount(item.unitPrice || item.priceSnapshot || item.price || 0),
      total: formatAmount(
        item.total ||
          item.totalItemAmount ||
          (item.quantity || 0) * (item.unitPrice || item.priceSnapshot || item.price || 0),
      ),
    })) ||
    invoice.lineItems.map((item) => ({
      name: item.description || "Menu Item",
      quantity: Number(item.quantity || 0),
      price: formatAmount(item.unitPrice || 0),
      total: formatAmount(item.total || 0),
    }));

  const latestPayment = invoice.paymentHistory?.length
    ? invoice.paymentHistory[invoice.paymentHistory.length - 1]
    : null;

  const subTotal = formatAmount(
    isSessionInvoice ? invoice.totalAmount ?? 0 : posOrder?.subTotal ?? invoice.totalAmount ?? 0,
  );
  const discount = formatAmount(
    isSessionInvoice
      ? invoice.discountAmount ?? 0
      : posOrder?.discountAmount ?? invoice.discountAmount ?? 0,
  );
  const taxableBase = formatAmount(Math.max(subTotal - discount, 0));
  const taxAmount = formatAmount(
    isSessionInvoice
      ? invoice.taxAmount ?? 0
      : financialSettings
      ? (taxableBase * Number(financialSettings.taxPercentage || 0)) / 100
      : posOrder?.totalTax ?? invoice.taxAmount ?? 0,
  );
  const serviceCharge = formatAmount(
    isSessionInvoice
      ? invoice.serviceChargeAmount ?? 0
      : financialSettings
      ? (taxableBase * Number(financialSettings.serviceChargePercentage || 0)) / 100
      : posOrder?.totalServiceCharge ?? invoice.serviceChargeAmount ?? 0,
  );
  const finalAmount = formatAmount(
    isSessionInvoice ? invoice.finalAmount ?? 0 : posOrder?.grandTotal ?? invoice.finalAmount ?? 0,
  );
  const paidAmount = formatAmount(invoice.paidAmount || 0);
  const paymentMethod =
    latestPayment?.method ||
    posOrder?.paymentMethod ||
    sessionOrders.find((order) => order.paymentMethod)?.paymentMethod ||
    "N/A";
  const paymentStatus =
    invoice.status === "PAID"
      ? "Paid"
      : invoice.status === "PARTIALLY_PAID"
        ? "Partially Paid"
        : "Pending";
  const staffNames = [
    ...new Set(
      sessionOrders
        .map((order) => order?.createdBy?.name)
        .filter(Boolean),
    ),
  ];
  const staffName =
    staffNames.length > 1
      ? "Multiple Staff"
      : staffNames[0] || posOrder?.createdBy?.name || "N/A";
  const orderDateTime = formatDateTime(
    sessionOrders[0]?.createdAt || posOrder?.createdAt || invoice.createdAt,
  );
  const orderType =
    orderTypeLabelMap[invoice.orderType] ||
    orderTypeLabelMap[posOrder?.orderType] ||
    invoice.orderType ||
    posOrder?.orderType ||
    "N/A";
  const customerName = invoice.guestName || booking?.guestName || "Walk-in Customer";
  const customerPhone = booking?.guestPhone || "N/A";
  const contactInfo =
    branch.contactNumber || organization.contactPhone || "N/A";
  const restaurantName = `${branch.name} Restaurant`;
  const orderRef =
    invoice.sessionId ||
    posOrder?.orderCode ||
    posOrder?.orderId ||
    invoice.referenceId ||
    "N/A";

  doc.rect(0, 0, 595, 22).fill(primaryColor);
  doc.rect(0, 22, 595, 124).fill("#FFFFFF");
  doc.rect(40, 40, 515, 88).fill(accentSoft);
  doc.rect(40, 40, 6, 88).fill(accentColor);

  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(24)
    .text(organization.name, 64, 54, {
      width: 240,
      lineBreak: false,
    });
  doc
    .fillColor(accentColor)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(branch.name, 64, 86, {
      width: 240,
      lineBreak: false,
    });
  doc
    .fillColor(mutedText)
    .font("Helvetica")
    .fontSize(11)
    .text(restaurantName, 64, 106, {
      width: 260,
      lineBreak: false,
    });

  // doc
  //   .fillColor(accentColor)
  //   .font("Helvetica-Bold")
  //   .fontSize(9)
  //   .text("RESTAURANT BILLING", 330, 56, {
  //     width: 200,
  //     align: "right",
  //     characterSpacing: 1.2,
  //   });
  // doc
  //   .fillColor(primaryColor)
  //   .font("Helvetica-Bold")
  //   .fontSize(18)
  //   .text("RESTAURANT POS", 330, 72, {
  //     width: 200,
  //     align: "right",
  //     lineBreak: false,
  //   });
  // doc
  //   .fillColor(primaryColor)
  //   .font("Helvetica-Bold")
  //   .fontSize(18)
  //   .text("INVOICE", 330, 94, {
  //     width: 200,
  //     align: "right",
  //     lineBreak: false,
  //   });

  doc.roundedRect(348, 56, 1, 56, 0).fill("#F0D7C3");

  doc
    .fillColor(mutedText)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("INVOICE ID", 365, 60, {
      width: 165,
      align: "right",
    });
  doc
    .fillColor(textColor)
    .font("Helvetica")
    .fontSize(10)
    .text(invoice.invoiceId, 365, 72, {
      width: 165,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });


  doc
    .fillColor(mutedText)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("ORDER REF", 365, 92, {
      width: 165,
      align: "right",
    });
    
  doc
    .fillColor(textColor)
    .font("Helvetica")
    .fontSize(10)
    .text(orderRef, 365, 104, {
      width: 165,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });

  let currentY = 160;

  const drawMetaCard = (x, y, width, title, value) => {
    doc.roundedRect(x, y, width, 54, 8).fillAndStroke("#FFFFFF", borderColor);
    doc
      .fillColor(mutedText)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(title, x + 12, y + 10);
    doc
      .fillColor(textColor)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(value || "N/A", x + 12, y + 26, {
        width: width - 24,
      });
  };

  drawMetaCard(40, currentY, 162, "DATE & TIME", orderDateTime);
  drawMetaCard(
    216,
    currentY,
    162,
    "TABLE / ORDER TYPE",
    (invoice.tableNo || posOrder?.tableNumber)
      ? `Table ${invoice.tableNo || posOrder?.tableNumber} • ${orderType}`
      : orderType,
  );
  drawMetaCard(392, currentY, 163, "WAITER / STAFF", staffName);

  currentY += 78;

  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Customer Details", 40, currentY);
  doc.rect(40, currentY + 18, 515, 1).fill(borderColor);
  currentY += 32;

  doc
    .fillColor(mutedText)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("CUSTOMER NAME", 40, currentY);
  doc
    .fillColor(textColor)
    .font("Helvetica")
    .fontSize(11)
    .text(customerName, 40, currentY + 14);
  doc
    .fillColor(mutedText)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("PHONE NUMBER", 300, currentY);
  doc
    .fillColor(textColor)
    .font("Helvetica")
    .fontSize(11)
    .text(customerPhone, 300, currentY + 14);

  currentY += 48;

  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Order Details", 40, currentY);
  currentY += 22;

  doc.rect(40, currentY, 515, 28).fill(tableHeaderBg);
  doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(10);
  doc.text("ITEM NAME", 52, currentY + 9);
  doc.text("QTY", 300, currentY + 9, { width: 45, align: "center" });
  doc.text("PRICE", 360, currentY + 9, { width: 80, align: "right" });
  doc.text("TOTAL", 455, currentY + 9, { width: 85, align: "right" });

  currentY += 28;

  items.forEach((item, index) => {
    const rowHeight = 28;
    if (index % 2 === 0) {
      doc.rect(40, currentY, 515, rowHeight).fill("#FFFFFF");
    } else {
      doc.rect(40, currentY, 515, rowHeight).fill("#FAFAF9");
    }

    doc.fillColor(textColor).font("Helvetica").fontSize(10);
    doc.text(item.name, 52, currentY + 9, { width: 220, ellipsis: true });
    doc.text(String(item.quantity), 300, currentY + 9, {
      width: 45,
      align: "center",
    });
    doc.text(formatCurrency(item.price, currencyCode), 360, currentY + 9, {
      width: 80,
      align: "right",
    });
    doc.text(formatCurrency(item.total, currencyCode), 455, currentY + 9, {
      width: 85,
      align: "right",
    });

    doc.rect(40, currentY + rowHeight, 515, 1).fill(borderColor);
    currentY += rowHeight;
  });

  currentY += 26;

  const summaryTop = currentY;
  doc
    .roundedRect(330, summaryTop, 225, 150, 10)
    .fillAndStroke("#FFFFFF", borderColor);
  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Billing Summary", 346, summaryTop + 14);

  const drawSummaryLine = (label, value, y, bold = false) => {
    doc
      .fillColor(mutedText)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .text(label, 346, y);
    doc
      .fillColor(textColor)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10)
      .text(formatCurrency(value, currencyCode), 450, y, {
        width: 90,
        align: "right",
      });
  };

  drawSummaryLine("Subtotal", subTotal, summaryTop + 42);
  drawSummaryLine("Tax", taxAmount, summaryTop + 64);
  drawSummaryLine("Service Charge", serviceCharge, summaryTop + 86);
  drawSummaryLine("Discount", discount, summaryTop + 108);
  doc.rect(346, summaryTop + 128, 190, 1).fill(borderColor);
  drawSummaryLine("Final Amount", finalAmount, summaryTop + 136, true);

  const paymentCardTop = summaryTop;
  doc
    .roundedRect(40, paymentCardTop, 272, 150, 10)
    .fillAndStroke("#FFFFFF", borderColor);
  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("Payment Details", 56, paymentCardTop + 14);

  const paymentBadgeBg = invoice.status === "PAID" ? successBg : warningBg;
  const paymentBadgeColor = invoice.status === "PAID" ? "#047857" : "#B45309";
  doc.roundedRect(192, paymentCardTop + 12, 104, 22, 11).fill(paymentBadgeBg);
  doc
    .fillColor(paymentBadgeColor)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(paymentStatus.toUpperCase(), 192, paymentCardTop + 19, {
      width: 104,
      align: "center",
    });

  const drawPaymentLine = (label, value, y) => {
    doc
      .fillColor(mutedText)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(label, 56, y);
    doc
      .fillColor(textColor)
      .font("Helvetica")
      .fontSize(10)
      .text(value || "N/A", 56, y + 12, { width: 220 });
  };

  drawPaymentLine(
    "PAID AMOUNT",
    formatCurrency(paidAmount, currencyCode),
    paymentCardTop + 44,
  );
  drawPaymentLine("PAYMENT METHOD", paymentMethod, paymentCardTop + 74);
  drawPaymentLine(
    "TRANSACTION ID",
    latestPayment?.transactionId || "N/A",
    paymentCardTop + 104,
  );

  currentY = summaryTop + 182;

  doc.rect(40, currentY, 515, 1).fill(borderColor);
  currentY += 20;

  doc
    .fillColor(primaryColor)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Thank you for dining with us!", 40, currentY);
  currentY += 16;
  doc
    .fillColor(mutedText)
    .font("Helvetica")
    .fontSize(9)
    .text(
      `${branch.address || "Branch address unavailable"} | Contact: ${contactInfo}`,
      40,
      currentY,
      { width: 380 },
    );
  doc
    .fillColor(mutedText)
    .font("Helvetica")
    .fontSize(9)
    .text(
      "Feedback QR can be added here in a future enhancement.",
      400,
      currentY,
      {
        width: 155,
        align: "right",
      },
    );
};

exports.generateInvoicePDF = (invoice, organization, branch, context = {}) => {
  const logoPath = organization.logoUrl
    ? path.join(__dirname, "../../", organization.logoUrl)
    : null;
  return new Promise((resolve, reject) => {
    const dir = path.join(__dirname, "../../storage/invoices");

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${invoice.invoiceId}.pdf`);

    // Create document
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    const normalizedContext =
      context &&
      (
        context.booking ||
        context.posOrder ||
        context.posOrders ||
        context.staff ||
        context.customer ||
        context.financialSettings
      )
        ? context
        : { booking: context };
    const currencyCode =
      getSystemSettings().baseCurrency || DEFAULT_CURRENCY;

    if (invoice.referenceType === "POS" || invoice.type === "RESTAURANT") {
      drawRestaurantInvoice(
        doc,
        invoice,
        organization,
        branch,
        normalizedContext.posOrder || null,
        normalizedContext.posOrders || [],
        normalizedContext.booking || null,
        normalizedContext.financialSettings || null,
        currencyCode,
      );
    } else {
      drawRoomInvoice(
        doc,
        invoice,
        organization,
        branch,
        normalizedContext.booking || null,
        normalizedContext.financialSettings || null,
        currencyCode,
      );
    }

    doc.end();

    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
};
