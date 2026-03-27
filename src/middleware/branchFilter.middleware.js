module.exports = (req, res, next) => {
  if (!req.user.branchId) return next();

  req.branchFilter = { branchId: req.user.branchId };
  next();
};
