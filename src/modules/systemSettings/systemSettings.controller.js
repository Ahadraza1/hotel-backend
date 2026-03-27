const {
  getSystemSettings,
  updateSystemSettings,
} = require("./systemSettings.store");

exports.getSystemSettings = async (req, res) => {
  try {
    res.status(200).json({
      data: getSystemSettings(),
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

exports.updateSystemSettings = async (req, res) => {
  try {
    const settings = updateSystemSettings(req.body);

    res.status(200).json({
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};
