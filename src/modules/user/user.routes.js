const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth.middleware");
const userController = require("./user.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const upload = require("../../middleware/upload.middleware");

/*
  Get Current Logged In User
*/
router.get("/me", requireAuth, userController.getCurrentUser);

/*
  Update Current User Profile
*/
router.put("/me", requireAuth, userController.updateCurrentUser);

/*
  Delete Current User Account
*/
router.delete("/me", requireAuth, userController.deleteCurrentUser);

/*
  Update Password
*/
router.put("/update-password", requireAuth, userController.updatePassword);

/*
  Update Avatar
*/
router.patch(
  "/me/avatar",
  requireAuth,
  upload.single("avatar"),
  userController.updateAvatar,
);

/*
  Get All Users
*/
router.get("/", requireAuth, userController.getUsers);

router.patch("/:userId/status", requireAuth, userController.updateUserStatus);

router.delete("/:userId", requireAuth, userController.deleteUser);

router.patch("/:userId/role", requireAuth, userController.changeUserRole);

module.exports = router;
