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
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // ✅ allow instead of throwing error
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-branch-id"],
  })
);

// ✅ handle preflight requests
app.options("/{*any}", cors());

app.use(express.json());

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
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
