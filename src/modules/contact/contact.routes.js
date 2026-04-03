const express = require("express");
const {
  submitContactForm,
  getPublicContactDetails,
} = require("./contact.controller");

const router = express.Router();

router.get("/public-details", getPublicContactDetails);
router.post("/", submitContactForm);

module.exports = router;
