const branchSettingsService = require("./branchSettings.service");
const asyncHandler = require("../../utils/asyncHandler");

/* ===========================
   GET SETTINGS
=========================== */
exports.getSettings = asyncHandler(async (req, res) => {

  const { branchId } = req.params;

  const settings = await branchSettingsService.getSettings(
    branchId,
    req.user
  );

  return res.status(200).json({
    success: true,
    data: settings,
  });
});


/* ===========================
   UPDATE FULL SETTINGS
=========================== */
exports.updateSettings = asyncHandler(async (req, res) => {

  const { branchId } = req.params;

  const updated = await branchSettingsService.updateSettings(
    branchId,
    req.body,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Branch settings updated successfully",
    data: updated,
  });
});


/* ===========================
   UPDATE SECTION
=========================== */
exports.updateSection = asyncHandler(async (req, res) => {

  const { branchId, section } = req.params;

  const updated = await branchSettingsService.updateSection(
    branchId,
    section,
    req.body,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: `${section} updated successfully`,
    data: updated,
  });
});


/* ===========================
   RESET SETTINGS
=========================== */
exports.resetSettings = asyncHandler(async (req, res) => {

  const { branchId } = req.params;

  const reset = await branchSettingsService.resetSettings(
    branchId,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Branch settings reset to default",
    data: reset,
  });
});