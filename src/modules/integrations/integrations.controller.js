exports.getIntegrations = async (req, res) => {
  try {
    res.status(200).json({
      data: [
        {
          name: "Stripe",
          status: "connected",
          type: "Payment Gateway",
        },
        {
          name: "Twilio",
          status: "connected",
          type: "SMS Service",
        },
        {
          name: "SendGrid",
          status: "disconnected",
          type: "Email Service",
        },
      ],
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};