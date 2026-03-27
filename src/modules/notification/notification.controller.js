const notificationService = require("./notification.service");

exports.getNotifications = async (req, res) => {
  try {
    const { limit } = req.query;
    const { notifications, total } =
      await notificationService.getNotificationsForUser(req.user, { limit });

    return res.json({
      data: notifications,
      meta: {
        total,
        limit: limit ? Number(limit) : null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch notifications",
    });
  }
};
