const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose-cjs");

dotenv.config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  try {
    await client.connect();

    const roomDb = client.db("studynook");
    const bookingDb = client.db("studynook_bookings");

    const roomCollection = roomDb.collection("roomcollections");
    const userCollection = roomDb.collection("users");
    const bookingCollection = bookingDb.collection("bookings");

    app.get("/rooms", async (req, res) => {
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
    });

    app.get("/rooms/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid ID" });

      const result = await roomCollection.findOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    app.post("/rooms",verifyToken, async (req, res) => {
      const roomData = req.body;
      const result = await roomCollection.insertOne(roomData);
      res.json(result);
    });

    app.patch("/rooms/:id", async (req, res) => {
      const { id } = req.params;
      const { _id, ...updatedFields } = req.body;

      const result = await roomCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedFields },
      );
      res.send(result);
    });

    app.delete("/rooms/:id", async (req, res) => {
      const { id } = req.params;

      await userCollection.updateMany(
        { "bookings.roomId": id },
        { $pull: { bookings: { roomId: id } } },
      );

      const result = await roomCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    app.post("/bookings", async (req, res) => {
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

      if (!roomId || !userEmail || !date || !startTime || !endTime) {
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
        userId: userId || "",
        userEmail,
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
        { email: userEmail },
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
    });

    app.get("/my-bookings", async (req, res) => {
      const userEmail = req.headers["user-email"];
      if (!userEmail) return res.json([]);

      const userBookings = await bookingCollection
        .find({ userEmail })
        .sort({ createdAt: -1 })
        .toArray();

      res.json(userBookings);
    });

    app.patch("/bookings/:id/cancel", async (req, res) => {
      const { id } = req.params;
      const userEmail = req.headers["user-email"];

      if (!ObjectId.isValid(id))
        return res.status(400).json({ message: "Invalid Booking ID" });

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!booking)
        return res.status(404).json({ message: "Booking not found" });

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
    });

    app.delete("/bookings/:id",verifyToken, async (req, res) => {
      const { id } = req.params;
      const userEmail = req.headers["user-email"];

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
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("Hello World!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
