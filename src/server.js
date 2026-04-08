const path = require("path");
require("dotenv").config();

const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const { initSocket } = require("./config/socket");

connectDB();

const PORT = process.env.PORT || 5000;

/*
  Create HTTP server
*/
const server = http.createServer(app);

/*
  Initialize Socket.io
*/
initSocket(server);

/*
  Start Server
*/
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});