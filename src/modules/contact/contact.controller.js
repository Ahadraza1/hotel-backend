const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const {
  sendContactEmail,
  sendContactThankYouEmail,
} = require("../../utils/sendEmail");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\d+$/;
const containsHeaderInjection = (value = "") => /[\r\n]/.test(String(value));

const normalizeContactEmail = (value = "") => String(value).trim().toLowerCase();

exports.getPublicContactDetails = asyncHandler(async (_req, res) => {
  const contactEmail = process.env.CONTACT_EMAIL || process.env.EMAIL_USER || "";

  res.status(200).json({
    email: contactEmail,
  });
});

exports.submitContactForm = asyncHandler(async (req, res) => {
  const name = req.body?.name?.trim();
  const email = normalizeContactEmail(req.body?.email);
  const phone = req.body?.phone?.trim();
  const message = req.body?.message?.trim();

  if (!name || !email || !phone || !message) {
    throw new AppError("All contact form fields are required", 400);
  }

  if (!emailRegex.test(email)) {
    throw new AppError("Please enter a valid email address", 400);
  }

  if (containsHeaderInjection(email)) {
    throw new AppError("Please enter a valid email address", 400);
  }

  if (!phoneRegex.test(phone)) {
    throw new AppError("Phone number must contain only numeric characters", 400);
  }

  if (!process.env.CONTACT_EMAIL && !process.env.EMAIL_USER) {
    throw new AppError(
      "CONTACT_EMAIL or EMAIL_USER must be configured on the server",
      500,
    );
  }

  await sendContactEmail({ name, email, phone, message });

  sendContactThankYouEmail({ name, email }).catch((error) => {
    console.error(
      "Failed to send contact thank-you email:",
      error?.message || error,
    );
  });

  res.status(200).json({
    message: "Message sent successfully",
  });
});
