const jwt = require("jsonwebtoken");
const User = require("../modules/user/user.model");

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.userId || decoded.id;

    const user = await User.findById(userId).select("-password").lean();

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "Account is deactivated" });
    }

    // 🔥 TAKE ACTIVE BRANCH FROM HEADER
    const activeBranchId = req.headers["x-branch-id"];

    if (!activeBranchId) {
      console.log("❌ No branch header received");
    } else {
      console.log("✅ Branch header received:", activeBranchId);
    }

    req.user = {
      _id: user._id,
      role: user.role,
      roleRef: user.roleRef,
      organizationId: user.organizationId,
      branchId: activeBranchId || null, // 🔥 force header only
      isPlatformAdmin: user.isPlatformAdmin,
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
};
