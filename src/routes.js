const express = require("express");
const router = express.Router();

const path = require("path");

const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/user/user.routes");
const roleRoutes = require("./modules/rbac/role.routes");
const organizationRoutes = require("./modules/organization/organization.routes");
const branchRoutes = require("./modules/branch/branch.routes");
const roomRoutes = require("./modules/room/room.routes");
const bookingRoutes = require("./modules/booking/booking.routes");
const financeRoutes = require("./modules/finance/finance.routes");
const financialReportsRoutes = require("./modules/financialReports/financialReports.routes");
const analyticsRoutes = require("./modules/analytics/analytics.routes");
const inventoryRoutes = require("./modules/inventory/inventory.routes");
const auditRoutes = require("./modules/audit/audit.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const permissionRoutes = require("./modules/rbac/permission.routes");
const systemSettingsRoutes = require("./modules/systemSettings/systemSettings.routes");
const securityRoutes = require("./modules/security/security.routes");
const integrationsRoutes = require("./modules/integrations/integrations.routes");
const housekeepingRoutes = require("./modules/housekeeping/housekeeping.routes");
const guestRoutes = require("./modules/crm/guest.routes");
const hrRoutes = require("./modules/hr/hr.routes");
const invoiceRoutes = require("./modules/invoice/invoice.routes");
const notificationRoutes = require("./modules/notification/notification.routes");
/* ✅ NEW POS ROUTES */
const posRoutes = require("./modules/pos/pos.routes");
const invitationRoutes = require("./modules/invitation/invitation.routes");
const branchSettingsRoutes = require("./modules/branchSettings/branchSettings.routes");
const serviceRoutes = require("./modules/service/service.routes");
const subscriptionRoutes = require("./modules/subscription/subscription.routes");
const subscriptionController = require("./modules/subscription/subscription.controller");
const contactRoutes = require("./modules/contact/contact.routes");


// ✅ Serve uploaded files
router.use("/uploads", express.static(path.join(__dirname, "../uploads")));

router.get("/public/subscription-plans", subscriptionController.getPublicPlans);
router.use("/contact", contactRoutes);
router.use("/auth", authRoutes);
router.use("/organizations", organizationRoutes);
router.use("/branches", branchRoutes);
router.use("/branch-settings", branchSettingsRoutes);
router.use("/services", serviceRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/permissions", permissionRoutes);
router.use("/rooms", roomRoutes);
router.use("/bookings", bookingRoutes);
router.use("/finance", financeRoutes);
router.use("/financial-reports", financialReportsRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/audit", auditRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/system-settings", systemSettingsRoutes);
router.use("/security", securityRoutes);
router.use("/integrations", integrationsRoutes);
router.use("/housekeeping", housekeepingRoutes);
router.use("/crm", guestRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/notifications", notificationRoutes);
/* ✅ NEW POS ROUTES */
router.use("/hr", hrRoutes);
router.use("/pos", posRoutes);
router.use("/invitations", invitationRoutes);

router.get("/health", (req, res) => {
  res.json({ message: "API running" });
});

module.exports = router;
