exports.getOverview = async (req, res) => {
  try {
    res.status(200).json({
      data: {
        failedLogins: 3,
        activeSessions: 12,
        suspiciousActivities: 1,
      },
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getLoginHistory = async (req, res) => {
  try {
    res.status(200).json({
      data: [
        {
          _id: "1",
          user: "admin@luxuryhms.com",
          ip: "192.168.1.1",
          date: new Date(),
          status: "success",
        },
      ],
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    res.status(200).json({
      data: [
        {
          _id: "1",
          action: "Created Branch",
          user: "Super Admin",
          date: new Date(),
        },
      ],
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};