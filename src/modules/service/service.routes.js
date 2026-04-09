const express = require("express");
const router = express.Router();

const serviceController = require("./service.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

router.post(
  "/",
  requireAuth,
  requirePermission("UPDATE_BOOKING"),
  auditMiddleware("SERVICE_CREATED", "BOOKING", "Created reusable service"),
  serviceController.createService,
);

router.get(
  "/",
  requireAuth,
  requirePermission("UPDATE_BOOKING"),
  serviceController.getServices,
);

router.delete(
  "/:serviceId",
  requireAuth,
  requirePermission("UPDATE_BOOKING"),
  auditMiddleware("SERVICE_DELETED", "BOOKING", "Deleted reusable service"),
  serviceController.deleteService,
);

module.exports = router;
