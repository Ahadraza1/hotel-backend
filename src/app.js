const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const path = require("path");
const errorHandler = require("./middleware/error.middleware");

const routes = require("./routes");

const app = express();

const allowedOrigins = [
  "http://localhost:8080",
  "https://hotel-frontend-six-woad.vercel.app",
];

// ✅ CORS should be BEFORE everything
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-branch-id"],
  }),
);

// ✅ ADD THIS (FINAL FIX FOR LIVE CORS)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (
    origin === "http://localhost:8080" ||
    origin === "https://hotel-frontend-six-woad.vercel.app"
  ) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-branch-id"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// ✅ preflight handler
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

app.use(morgan("dev"));
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/", (req, res) => {
  res.send("Hotel Management Backend is running 🚀");
});

app.use("/api", routes);

app.use(errorHandler);

module.exports = app;