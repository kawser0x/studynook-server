const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet, SignJWT } = require("jose-cjs");

dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.length === 0) {
        callback(null, true);
      } else {
        callback(null, true); // Allow for development flexibility
      }
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = process.env.MONGODB_URI;

let client;
function getDb() {
  if (!uri) return null;
  if (!client) {
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
  }
  return client;
}

const secretKey = process.env.BETTER_AUTH_SECRET
  ? new TextEncoder().encode(process.env.BETTER_AUTH_SECRET)
  : new TextEncoder().encode("studynook_default_jwt_secret_key_2026");

let JWKS;
function getJWKS() {
  if (!JWKS && process.env.CLIENT_URL) {
    try {
      JWKS = createRemoteJWKSet(
        new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
      );
    } catch (e) {
      console.error("JWKS Initialization Error:", e.message);
    }
  }
  return JWKS;
}

const verifyToken = async (req, res, next) => {
  const cookieToken = req.cookies?.token;
  const authHeader = req?.headers.authorization;
  const token = cookieToken || (authHeader ? authHeader.split(" ")[1] : null);

  // Fallback for user email in headers if token is missing
  if (!token) {
    const headerEmail = req.headers["user-email"];
    if (headerEmail) {
      req.user = { email: headerEmail, id: req.headers["user-id"] || "" };
      return next();
    }
    return res
      .status(401)
      .json({ message: "Unauthorized: Missing token or user identity" });
  }

  try {
    if (secretKey) {
      try {
        const { payload } = await jwtVerify(token, secretKey);
        req.user = {
          id: payload.userId || payload.sub || payload.id,
          email: payload.email || payload.userEmail,
          ...payload,
        };
        return next();
      } catch (e) {
        // Fallthrough to remote JWKS if secret key verification fails
      }
    }

    const remoteJWKS = getJWKS();
    if (remoteJWKS) {
      const { payload } = await jwtVerify(token, remoteJWKS);
      req.user = {
        id: payload.userId || payload.sub || payload.id,
        email: payload.email || payload.userEmail,
        ...payload,
      };
      return next();
    }

    throw new Error("No verification key configured");
  } catch (error) {
    console.error("Token verification failed:", error.message);
    const headerEmail = req.headers["user-email"];
    if (headerEmail) {
      req.user = { email: headerEmail, id: req.headers["user-id"] || "" };
      return next();
    }
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid or expired token" });
  }
};

app.get("/", async (req, res) => {
  res.send("StudyNook Server is Running!");
});

// JWT Login / Issue Token Endpoint (HTTP-Only Cookie)
app.post("/jwt", async (req, res) => {
  try {
    const { userId, email } = req.body;
    if (!userId || !email) {
      return res.status(400).json({ message: "Missing userId or email" });
    }

    const token = await new SignJWT({ userId, email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secretKey);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, message: "Token issued successfully", token });
  } catch (error) {
    console.error("JWT Issue Error:", error);
    res.status(500).json({ message: "Failed to issue token" });
  }
});

// Logout Endpoint (Clear Cookie)
app.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.json({ success: true, message: "Logged out successfully" });
});

// GET /rooms with Search, Filtering & MongoDB sort/limit
app.get("/rooms", async (req, res) => {
  try {
    const mongoClient = getDb();
    if (!mongoClient) {
      return res.status(500).json({ message: "Database URI not configured" });
    }

    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");
    const { search, amenities, floor, minPrice, maxPrice, limit, sort } = req.query;
    const query = {};

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    if (amenities) {
      const amenitiesList = Array.isArray(amenities)
        ? amenities
        : amenities.split(",").map((a) => a.trim());
      if (amenitiesList.length > 0 && amenitiesList[0] !== "") {
        query.amenities = { $in: amenitiesList };
      }
    }

    if (floor && floor !== "all") {
      query.floor = { $regex: floor, $options: "i" };
    }

    if (minPrice || maxPrice) {
      query.hourlyRate = {};
      if (minPrice) query.hourlyRate.$gte = Number(minPrice);
      if (maxPrice) query.hourlyRate.$lte = Number(maxPrice);
    }

    let cursor = roomCollection.find(query);

    // MongoDB sort()
    if (sort === "latest" || limit) {
      cursor = cursor.sort({ _id: -1 });
    }

    // MongoDB limit()
    if (limit) {
      cursor = cursor.limit(Number(limit));
    }

    const result = await cursor.toArray();
    res.json(result);
  } catch (error) {
    console.error("GET /rooms Error:", error);
    res.status(500).json({ message: "Error fetching rooms" });
  }
});

// GET /my-listings (Owner Rooms)
app.get("/my-listings", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    if (!mongoClient)
      return res.status(500).json({ message: "Database not configured" });

    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");

    const userEmail = req.user?.email || req.headers["user-email"];
    const userId = req.user?.id || req.user?.sub;

    if (!userEmail && !userId) return res.json([]);

    const query = {
      $or: [
        { userEmail: userEmail },
        { ownerEmail: userEmail },
        { userId: userId },
        { ownerId: userId },
      ].filter((cond) => Object.values(cond)[0]),
    };

    const userRooms = await roomCollection
      .find(query.length > 0 ? query : {})
      .sort({ _id: -1 })
      .toArray();

    res.json(userRooms);
  } catch (error) {
    console.error("GET /my-listings Error:", error);
    res.status(500).json({ message: "Error fetching user listings" });
  }
});

// GET /rooms/:id
app.get("/rooms/:id", async (req, res) => {
  try {
    const mongoClient = getDb();
    if (!mongoClient)
      return res.status(500).json({ message: "Database not configured" });

    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Room ID" });
    }

    const result = await roomCollection.findOne({ _id: new ObjectId(id) });
    if (!result) return res.status(404).json({ message: "Room not found" });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Error fetching room details" });
  }
});

// POST /rooms (Create Room)
app.post("/rooms", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");

    const roomData = req.body;
    const userEmail = req.user?.email || roomData.userEmail || roomData.ownerEmail || "";
    const userId = req.user?.id || req.user?.sub || roomData.userId || roomData.ownerId || "";

    const newRoom = {
      ...roomData,
      userEmail,
      ownerEmail: userEmail,
      userId,
      ownerId: userId,
      bookingCount: 0,
      createdAt: new Date(),
    };

    const result = await roomCollection.insertOne(newRoom);
    res.status(201).json({ message: "Room added successfully", ...result });
  } catch (error) {
    console.error("POST /rooms Error:", error);
    res.status(500).json({ message: "Failed to add room" });
  }
});

// PATCH /rooms/:id (Update Room - Owner Only)
app.patch("/rooms/:id", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");
    const { id } = req.params;
    const { _id, ...updatedFields } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Room ID" });
    }

    const room = await roomCollection.findOne({ _id: new ObjectId(id) });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const currentUserEmail = req.user?.email || req.headers["user-email"];
    const currentUserId = req.user?.id || req.user?.sub;

    const isOwner =
      !room.userEmail && !room.ownerEmail
        ? true
        : room.userEmail === currentUserEmail ||
          room.ownerEmail === currentUserEmail ||
          room.userId === currentUserId ||
          room.ownerId === currentUserId;

    if (!isOwner) {
      return res
        .status(403)
        .json({ message: "Forbidden: Only room owner can edit this room" });
    }

    const result = await roomCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedFields }
    );

    res.json({ message: "Room updated successfully", result });
  } catch (error) {
    console.error("PATCH /rooms/:id Error:", error);
    res.status(500).json({ message: "Failed to update room" });
  }
});

// DELETE /rooms/:id (Delete Room - Owner Only)
app.delete("/rooms/:id", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomDb = mongoClient.db("studynook");
    const roomCollection = roomDb.collection("roomcollections");
    const userCollection = roomDb.collection("users");
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Room ID" });
    }

    const room = await roomCollection.findOne({ _id: new ObjectId(id) });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const currentUserEmail = req.user?.email || req.headers["user-email"];
    const currentUserId = req.user?.id || req.user?.sub;

    const isOwner =
      !room.userEmail && !room.ownerEmail
        ? true
        : room.userEmail === currentUserEmail ||
          room.ownerEmail === currentUserEmail ||
          room.userId === currentUserId ||
          room.ownerId === currentUserId;

    if (!isOwner) {
      return res
        .status(403)
        .json({ message: "Forbidden: Only room owner can delete this room" });
    }

    // $pull room ID from user's bookings array
    await userCollection.updateMany(
      { "bookings.roomId": id },
      { $pull: { bookings: { roomId: id } } }
    );

    const result = await roomCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "Room deleted successfully", result });
  } catch (error) {
    console.error("DELETE /rooms/:id Error:", error);
    res.status(500).json({ message: "Failed to delete room" });
  }
});

// POST /bookings (Book a Room with Conflict Detection & $push)
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomDb = mongoClient.db("studynook");
    const bookingDb = mongoClient.db("studynook_bookings");

    const roomCollection = roomDb.collection("roomcollections");
    const userCollection = roomDb.collection("users");
    const bookingCollection = bookingDb.collection("bookings");

    const {
      roomId,
      userId,
      userEmail,
      date,
      startTime,
      endTime,
      totalCost,
      specialNote,
    } = req.body;

    const email = req.user?.email || userEmail;

    if (!roomId || !email || !date || !startTime || !endTime) {
      return res
        .status(400)
        .json({ message: "Missing required booking details." });
    }

    // Conflict Check using $gte and $lte to prevent overlapping bookings
    const conflict = await bookingCollection.findOne({
      roomId,
      date,
      status: "confirmed",
      $or: [
        {
          startTime: { $lt: endTime },
          endTime: { $gt: startTime },
        },
      ],
    });

    if (conflict) {
      return res.status(409).json({
        message: "This room is already reserved for the selected time slot.",
      });
    }

    const room = await roomCollection.findOne({ _id: new ObjectId(roomId) });
    if (!room) {
      return res.status(404).json({ message: "Room not found." });
    }

    const newBooking = {
      roomId,
      roomName: room.name,
      roomImage: room.image,
      userId: req.user?.sub || req.user?.id || userId || "",
      userEmail: email,
      date,
      startTime,
      endTime,
      totalCost: Number(totalCost),
      specialNote: specialNote || "",
      status: "confirmed",
      createdAt: new Date(),
    };

    const bookingResult = await bookingCollection.insertOne(newBooking);

    // $inc bookingCount on room
    await roomCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } }
    );

    // $push booking ID into user's bookings array
    await userCollection.updateOne(
      { email },
      {
        $push: {
          bookings: {
            bookingId: bookingResult.insertedId.toString(),
            roomId,
          },
        },
      }
    );

    res.status(201).json({
      message: "Room booked successfully!",
      bookingId: bookingResult.insertedId,
    });
  } catch (error) {
    console.error("POST /bookings Error:", error);
    res.status(500).json({ message: "Booking failed" });
  }
});

// GET /my-bookings
app.get("/my-bookings", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const bookingCollection = mongoClient
      .db("studynook_bookings")
      .collection("bookings");
    const userEmail = req.user?.email || req.headers["user-email"];

    if (!userEmail) return res.json([]);

    const userBookings = await bookingCollection
      .find({ userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(userBookings);
  } catch (error) {
    console.error("GET /my-bookings Error:", error);
    res.status(500).json({ message: "Error fetching bookings" });
  }
});

// PATCH /bookings/:id/cancel (Cancel Booking with $pull)
app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomDb = mongoClient.db("studynook");
    const bookingDb = mongoClient.db("studynook_bookings");

    const roomCollection = roomDb.collection("roomcollections");
    const userCollection = roomDb.collection("users");
    const bookingCollection = bookingDb.collection("bookings");

    const { id } = req.params;
    const userEmail = req.user?.email || req.headers["user-email"];

    if (!ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid Booking ID" });

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.userEmail !== userEmail) {
      return res
        .status(403)
        .json({ message: "Unauthorized to cancel this booking" });
    }

    await bookingCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled", cancelledAt: new Date() } }
    );

    // $pull booking ID from user's bookings array
    await userCollection.updateOne(
      { email: userEmail },
      { $pull: { bookings: { bookingId: id } } }
    );

    // $inc room bookingCount by -1
    if (ObjectId.isValid(booking.roomId)) {
      await roomCollection.updateOne(
        { _id: new ObjectId(booking.roomId) },
        { $inc: { bookingCount: -1 } }
      );
    }

    res.json({ message: "Booking cancelled successfully" });
  } catch (error) {
    console.error("PATCH /bookings/:id/cancel Error:", error);
    res.status(500).json({ message: "Cancellation failed" });
  }
});

// DELETE /bookings/:id
app.delete("/bookings/:id", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomDb = mongoClient.db("studynook");
    const bookingDb = mongoClient.db("studynook_bookings");

    const roomCollection = roomDb.collection("roomcollections");
    const userCollection = roomDb.collection("users");
    const bookingCollection = bookingDb.collection("bookings");

    const { id } = req.params;
    const userEmail = req.user?.email || req.headers["user-email"];

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Booking ID" });
    }

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.userEmail !== userEmail) {
      return res
        .status(403)
        .json({ message: "Unauthorized to delete this booking" });
    }

    await bookingCollection.deleteOne({ _id: new ObjectId(id) });

    await userCollection.updateOne(
      { email: userEmail },
      { $pull: { bookings: { bookingId: id } } }
    );

    if (booking.status === "confirmed" && ObjectId.isValid(booking.roomId)) {
      await roomCollection.updateOne(
        { _id: new ObjectId(booking.roomId) },
        { $inc: { bookingCount: -1 } }
      );
    }

    res.json({ message: "Booking permanently deleted" });
  } catch (error) {
    console.error("DELETE /bookings/:id Error:", error);
    res.status(500).json({ message: "Deletion failed" });
  }
});

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
