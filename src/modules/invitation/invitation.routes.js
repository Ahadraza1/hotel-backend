const express = require("express");
const router = express.Router();

const invitationController = require("./invitation.controller");
const authMiddleware = require("../../middleware/auth.middleware"); 
// adjust path if needed

// Create Invitation
router.post(
  "/",
  authMiddleware,
  invitationController.createInvitation
);

router.get(
  "/pending",
  authMiddleware,
  invitationController.getPendingInvitations
);
router.patch("/:id", authMiddleware, invitationController.updateInvitation);
router.post("/accept", invitationController.acceptInvitation);

router.patch(
  "/:id/cancel",
  authMiddleware,
  invitationController.cancelInvitation
);

router.post("/:id/resend", authMiddleware, invitationController.resendInvitation);

router.delete("/:id", authMiddleware, invitationController.cancelInvitation);


module.exports = router;
