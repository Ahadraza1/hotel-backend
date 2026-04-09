const serviceService = require("./service.service");

exports.createService = async (req, res) => {
  try {
    const service = await serviceService.createService(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: service,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create service",
    });
  }
};

exports.getServices = async (req, res) => {
  try {
    const services = await serviceService.getServices(req.user, req.query.branchId);

    return res.status(200).json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to fetch services",
    });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const service = await serviceService.deleteService(req.params.serviceId, req.user);

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully",
      data: service,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to delete service",
    });
  }
};
