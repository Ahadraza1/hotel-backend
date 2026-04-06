const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const authController = require("./auth.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const upload = require("../../middleware/upload.middleware");

const sendOtpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many OTP requests. Please try again later.",
  },
});

router.post("/register", authController.registerSuperAdmin);
router.get("/signup-plans", authController.getSignupPlans);
router.post("/organization-signup", authController.registerOrganization);
router.post("/signup/checkout/order", authController.createSignupCheckoutOrder);
router.post("/signup/checkout/verify", authController.verifySignupCheckout);
router.post("/signup/checkout/fail", authController.markSignupCheckoutFailed);
router.get(
  "/signup/checkout/session/:checkoutReference",
  authController.getSignupCheckoutSession,
);
router.post("/login", authController.login);
router.post("/send-otp", sendOtpRateLimiter, authController.sendPasswordResetOtp);
router.post("/verify-otp", authController.verifyPasswordResetOtp);
router.post("/reset-password", authController.resetPasswordWithOtp);
router.post("/accept-invite", authController.acceptInvite);

/*
  GET CURRENT AUTH USER
*/
router.get("/me", requireAuth, authController.getMe);

/*
  UPDATE PROFILE (INCLUDING AVATAR)
*/
router.put(
  "/update-profile",
  requireAuth,
  upload.single("avatar"),
  authController.updateProfile
);

module.exports = router;
