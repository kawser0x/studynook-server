const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
app.use(cors());
const PORT = process.env.PORT;
const uri = process.env.MONGODB_URI;

app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("studynook");
    const roomCollection = db.collection("roomcollections");

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

    app.get("/rooms/:id", async (req, res) => {
      const { id } = req.params;

      const result = await roomCollection.findOne({ _id: new ObjectId(id) });

      res.json(result);
    });

    app.post("/rooms", async (req, res) => {
      const roomData = req.body;
      const result = await roomCollection.insertOne(roomData);
      res.json(result);
    });

    const result = await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    return result;
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("Hello World!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
