# 🛠️ StudyNook Server – Node.js & Express REST API Backend

**Live Frontend Website:** [https://studynook-hazel.vercel.app/](https://studynook-hazel.vercel.app/)  
**Backend GitHub Repository:** [https://github.com/kawser0x/studynook-server](https://github.com/kawser0x/studynook-server)  
**Frontend GitHub Repository:** [https://github.com/kawser0x/studynook](https://github.com/kawser0x/studynook)

StudyNook Server is the core RESTful API service powering the **StudyNook** library study room booking platform. Built with Node.js, Express, and MongoDB Native Driver, it provides secure JWT cookie-based authentication, real-time time-conflict detection for room bookings, owner-only authorization middleware, and dynamic MongoDB query operations.

---

## ⚡ Key Features & API Highlights

- 🔑 **JWT HTTP-Only Cookie Authentication (`/jwt`, `/logout`)**: Generates and verifies signed JWT tokens stored securely in HTTP-only cookies (`httpOnly: true`, `secure: true`, `sameSite: 'strict'`).
- 🛑 **Time-Overlap Conflict Detection**: Prevents double-booking by enforcing MongoDB `$gte` and `$lte` queries on overlapping booking time slots for the same room and date.
- 📦 **MongoDB `$push` and `$pull` Array Management**: Dynamically updates user booking arrays (`$push` on reservation, `$pull` on cancellation or deletion) and increments/decrements room `bookingCount` using `$inc`.
- 🔍 **Advanced Querying (`$regex`, `$in`, `$gte`, `$lte`)**: Supports flexible room search by name (`$regex`), amenities filtering (`$in`), hourly rate filtering (`$gte`/`$lte`), and floor levels.
- ⚡ **MongoDB `sort()` and `limit()` Methods**: Homepage latest room queries utilize native MongoDB `.sort({ _id: -1 })` and `.limit(6)` for high performance.
- 🔒 **Owner-Only Route Protection**: Restricts room modification (`PATCH /rooms/:id`) and deletion (`DELETE /rooms/:id`) to the authentic room owner (`userEmail` / `userId`).

---

## 📡 API Endpoints Overview

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Public | Health check / Server status |
| `GET` | `/rooms` | Public | Fetch all rooms (supports `search`, `amenities`, `minPrice`, `maxPrice`, `floor`, `limit`, `sort`) |
| `GET` | `/rooms/:id` | Public | Fetch single room details by ID |
| `POST` | `/rooms` | Private | Create a new study room listing |
| `PATCH` | `/rooms/:id` | Private (Owner) | Update room details |
| `DELETE` | `/rooms/:id` | Private (Owner) | Permanently delete room and pull from user bookings |
| `GET` | `/my-listings` | Private | Fetch rooms created by the logged-in user |
| `POST` | `/bookings` | Private | Book a room with time-conflict check (`$push` booking ID) |
| `GET` | `/my-bookings` | Private | Fetch reservations for the logged-in user |
| `PATCH` | `/bookings/:id/cancel` | Private | Cancel booking (set status `cancelled`, `$pull` booking ID) |
| `DELETE` | `/bookings/:id` | Private | Permanently delete booking record |
| `POST` | `/jwt` | Public | Issue HTTP-only JWT auth cookie |
| `POST` | `/logout` | Public | Clear HTTP-only JWT auth cookie |

---

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express 5
- **Database**: MongoDB Native Driver (`mongodb`)
- **Authentication**: Jose JWT (`jose-cjs`) & Cookie Parser (`cookie-parser`)
- **Middleware**: CORS & Dotenv

---

## 🚀 Getting Started Locally

### 1. Installation
```bash
git clone https://github.com/kawser0x/studynook-server.git
cd studynook-server
npm install
```

### 2. Configure Environment Variables (`.env`)
Create a `.env` file in the root directory:
```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
BETTER_AUTH_SECRET=your_jwt_secret_key
CLIENT_URL=https://studynook-hazel.vercel.app # or http://localhost:3000
NODE_ENV=development
```

### 3. Start the Server
```bash
npm run start
```
The server will run on `http://localhost:5000`.

---

## 📄 License
This project is licensed under the MIT License.
