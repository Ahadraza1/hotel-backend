const express = require("express");
const { submitContactForm } = require("./contact.controller");

const router = express.Router();

router.post("/", submitContactForm);

module.exports = router;
