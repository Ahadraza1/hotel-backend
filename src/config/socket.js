const { Server } = require("socket.io");

let io;

/*
  INIT SOCKET
*/
function initSocket(server) {

  io = new Server(server, {
    cors: {
      origin: "http://localhost:8080",
      methods: ["GET", "POST", "PATCH", "PUT"],
      credentials: true
    },
  });

  io.on("connection", (socket) => {

    console.log("🔌 Client connected:", socket.id);

    /**
     * Join Branch Room
     */
    socket.on("join-branch", (branchId) => {

      if (!branchId) return;

      const room = `branch-${branchId}`;

      socket.join(room);

      console.log(`📍 Socket ${socket.id} joined ${room}`);

    });

    /**
     * Join Kitchen Station
     */
    socket.on("join-station", ({ branchId, station }) => {

      if (!branchId || !station) return;

      const room = `station-${branchId}-${station}`;

      socket.join(room);

      console.log(`🍳 Socket ${socket.id} joined ${room}`);

    });

    /**
     * Disconnect
     */
    socket.on("disconnect", () => {

      console.log("❌ Client disconnected:", socket.id);

    });

  });

}

/*
  GET SOCKET INSTANCE
*/
function getIO() {

  if (!io) {
    throw new Error("Socket.io not initialized");
  }

  return io;

}

module.exports = {
  initSocket,
  getIO
};