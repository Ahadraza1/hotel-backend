const Branch = require("./branch.model");

exports.getBranchDashboard = async (req, res) => {
  try {
    const branch = await Branch.findOne({
      branchId: req.user.branchId,
    });

    if (!branch) {
      return res.status(404).json({
        message: "Branch not found",
      });
    }

    res.status(200).json({
      message: "Branch Dashboard Data",
      data: {
        branchInfo: branch,
        // Future: room count, booking stats, revenue summary
      },
    });

  } catch (error) {
    res.status(500).json({
      message: "Failed to load dashboard",
    });
  }
};
