const subscriptionService = require("./subscription.service");

const handleError = (res, error, status = 400) => {
  console.error("❌ FULL ERROR:", error); // 🔥 add this
  res.status(status).json({
    message: error.message || "Request failed",
  });
};

exports.getDashboard = async (req, res) => {
  try {
    const data = await subscriptionService.getDashboardData(req.user);
    res.status(200).json({ data });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.getPlans = async (req, res) => {
  try {
    const data = await subscriptionService.listPlans(req.user);
    res.status(200).json({ data });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.getPublicPlans = async (req, res) => {
  try {
    const data = await subscriptionService.listPublicPlans();
    res.status(200).json(data);
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.createPlan = async (req, res) => {
  try {
    const data = await subscriptionService.createPlan(req.body);
    res.status(201).json({ message: "Plan created successfully", data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const data = await subscriptionService.updatePlan(
      req.params.planId,
      req.body,
    );
    res.status(200).json({ message: "Plan updated successfully", data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const data = await subscriptionService.deletePlan(req.params.planId);
    res.status(200).json(data);
  } catch (error) {
    handleError(res, error);
  }
};

exports.getOrganizations = async (req, res) => {
  try {
    const data = await subscriptionService.listOrganizationSubscriptions(
      req.user,
    );
    res.status(200).json({ data });
  } catch (error) {
    handleError(res, error, 500);
  }
};

exports.assignPlan = async (req, res) => {
  try {
    const data = await subscriptionService.assignPlanToOrganization({
      organizationId: req.params.organizationId,
      planId: req.body.planId,
      billingCycle: req.body.billingCycle,
      assignedBy: req.user._id,
    });

    res.status(200).json({
      message: "Subscription assigned successfully",
      data,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.cancelOrganizationPlan = async (req, res) => {
  try {
    const data = await subscriptionService.cancelOrganizationSubscription({
      organizationId: req.params.organizationId,
      assignedBy: req.user._id,
    });

    res.status(200).json({
      message: "Subscription cancelled successfully",
      data,
    });
  } catch (error) {
    handleError(res, error);
  }
};

exports.getBranchEligibility = async (req, res) => {
  try {
    const data = await subscriptionService.getBranchEligibility(
      req.user,
      req.query.organizationId || null,
    );
    res.status(200).json({ data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.createCheckoutOrder = async (req, res) => {
  try {
    console.log("📦 Create Order Request:", {
      user: req.user?._id,
      body: req.body,
    });

    if (!req.body || !req.body.planId) {
      return res.status(400).json({
        message: "PlanId is required",
      });
    }

    const data = await subscriptionService.createRazorpayOrder(
      req.user,
      req.body,
    );

    res.status(200).json({ data });
  } catch (error) {
    handleError(res, error);
  }
};

exports.verifyCheckout = async (req, res) => {
  try {
    console.log("💳 Verify Payment:", req.body);

    const data = await subscriptionService.verifyRazorpayPayment(
      req.user,
      req.body,
    );

    res.status(200).json({
      message: "Subscription activated successfully",
      data,
    });
  } catch (error) {
    handleError(res, error);
  }
};
