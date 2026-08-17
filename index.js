const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose-cjs");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
  : null;

let JWKS;
function getJWKS() {
  if (!JWKS && process.env.CLIENT_URL) {
    try {
      JWKS = createRemoteJWKSet(
        new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
      );
    } catch (e) {
      console.error("JWKS Initialization Error:", e.message);
    }
  }
  return JWKS;
}

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .json({ message: "Unauthorized: Missing token header" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res
      .status(401)
      .json({ message: "Unauthorized: Invalid token format" });
  }

  try {
    if (secretKey) {
      try {
        const { payload } = await jwtVerify(token, secretKey);
        req.user = payload;
        return next();
      } catch (e) {
      }
    }

    const remoteJWKS = getJWKS();
    if (remoteJWKS) {
      const { payload } = await jwtVerify(token, remoteJWKS);
      req.user = payload;
      return next();
    }

    throw new Error("No verification key configured");
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res
      .status(403)
      .json({ message: "Forbidden: Invalid or expired token" });
  }
};

app.get("/", async (req, res) => {
  res.send("StudyNook Server is Running!");
});

app.get("/rooms", async (req, res) => {
  try {
    const mongoClient = getDb();
    if (!mongoClient) {
      return res.status(500).json({ message: "Database URI not configured" });
    }

    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");
    const { search, amenities, floor, minPrice, maxPrice } = req.query;
    const query = {};

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    if (amenities) {
      const amenitiesList = Array.isArray(amenities)
        ? amenities
        : amenities.split(",").map((a) => a.trim());
      if (amenitiesList.length > 0) {
        query.amenities = { $in: amenitiesList };
      }
    }

    if (floor && floor !== "all") {
      query.floor = floor;
    }

    if (minPrice || maxPrice) {
      query.hourlyRate = {};
      if (minPrice) query.hourlyRate.$gte = Number(minPrice);
      if (maxPrice) query.hourlyRate.$lte = Number(maxPrice);
    }

    const result = await roomCollection.find(query).toArray();
    res.json(result);
  } catch (error) {
    console.error("GET /rooms Error:", error);
    res.status(500).json({ message: "Error fetching rooms" });
  }
});

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

app.post("/rooms", verifyToken, async (req, res) => {
  try {
    const mongoClient = getDb();
    const roomCollection = mongoClient
      .db("studynook")
      .collection("roomcollections");
    const roomData = req.body;
    const result = await roomCollection.insertOne(roomData);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to add room" });
  }
});

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

    const result = await roomCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedFields },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.json({ message: "Room updated successfully", result });
  } catch (error) {
    res.status(500).json({ message: "Failed to update room" });
  }
});

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

    await userCollection.updateMany(
      { "bookings.roomId": id },
      { $pull: { bookings: { roomId: id } } },
    );

    const result = await roomCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "Room deleted successfully", result });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete room" });
  }
});

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
      userId: req.user?.sub || userId || "",
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

    await roomCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } },
    );

    await userCollection.updateOne(
      { email },
      {
        $push: {
          bookings: {
            bookingId: bookingResult.insertedId.toString(),
            roomId,
          },
        },
      },
    );

    res.status(201).json({
      message: "Room booked successfully!",
      bookingId: bookingResult.insertedId,
    });
  } catch (error) {
    res.status(500).json({ message: "Booking failed" });
  }
});

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
    res.status(500).json({ message: "Error fetching bookings" });
  }
});

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
      { $set: { status: "cancelled", cancelledAt: new Date() } },
    );

    await userCollection.updateOne(
      { email: userEmail },
      { $pull: { bookings: { bookingId: id } } },
    );

    if (ObjectId.isValid(booking.roomId)) {
      await roomCollection.updateOne(
        { _id: new ObjectId(booking.roomId) },
        { $inc: { bookingCount: -1 } },
      );
    }

    res.json({ message: "Booking cancelled successfully" });
  } catch (error) {
    res.status(500).json({ message: "Cancellation failed" });
  }
});

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
      { $pull: { bookings: { bookingId: id } } },
    );

    if (booking.status === "confirmed" && ObjectId.isValid(booking.roomId)) {
      await roomCollection.updateOne(
        { _id: new ObjectId(booking.roomId) },
        { $inc: { bookingCount: -1 } },
      );
    }

    res.json({ message: "Booking permanently deleted" });
  } catch (error) {
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
