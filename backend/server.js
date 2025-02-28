const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const port = 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup storage for images using multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploaded_images");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Ensure the uploaded_images folder exists
if (!fs.existsSync("uploaded_images")) {
  fs.mkdirSync("uploaded_images");
}

// CSV file to store reports
const CSV_FILE = "reports.csv";

// Create CSV file with headers if it does not exist
if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(
    CSV_FILE,
    "id,image_filename,latitude,longitude,location,description,status\n"
  );
}

// In-memory users array for signup/login
const users = [];

// Utility function to hash a password
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// -----------------------------------------------------------------------------
// Endpoint: POST /user/report/
// Upload a report (with an image file and metadata)
app.post("/user/report/", upload.single("image"), (req, res) => {
  try {
    const { latitude, longitude, location, description } = req.body;
    const image = req.file;
    if (!image) {
      return res.status(400).json({ message: "Image file is required." });
    }
    // Generate a unique report ID by counting the lines in the CSV (header included)
    const csvData = fs.readFileSync(CSV_FILE, "utf8");
    const lines = csvData.trim().split("\n");
    const reportId = lines.length; // header exists so this works as a unique id

    // Append new report data to the CSV file
    const newRow = `${reportId},${image.filename},${latitude},${longitude},${location},${description},not_resolved\n`;
    fs.appendFileSync(CSV_FILE, newRow);

    res.json({
      id: reportId,
      image_filename: image.filename,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      location,
      description,
      status: "not_resolved",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to upload report." });
  }
});

// -----------------------------------------------------------------------------
// Endpoint: GET /user/reports/
// Fetch all reports from the CSV file
app.get("/user/reports/", (req, res) => {
  try {
    const csvData = fs.readFileSync(CSV_FILE, "utf8");
    const lines = csvData.trim().split("\n");
    const reports = [];
    const headers = lines[0].split(",");
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(",");
      const report = {};
      headers.forEach((header, index) => {
        // Convert numeric fields appropriately
        if (
          header === "latitude" ||
          header === "longitude" ||
          header === "id"
        ) {
          report[header] = Number(row[index]);
        } else {
          report[header] = row[index];
        }
      });
      reports.push(report);
    }
    res.json(reports);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch reports." });
  }
});

// -----------------------------------------------------------------------------
// Endpoint: PUT /admin/report/:report_id/status
// Update the status of a given report in the CSV file
app.put("/admin/report/:report_id/status", (req, res) => {
  try {
    const reportId = req.params.report_id;
    const { status } = req.body;
    const csvData = fs.readFileSync(CSV_FILE, "utf8");
    const lines = csvData.trim().split("\n");
    const headers = lines[0];
    let reportFound = false;

    // Update the status field for the matching report
    const updatedLines = lines.map((line, index) => {
      if (index === 0) return line; // header
      const row = line.split(",");
      if (row[0] === reportId) {
        row[6] = status; // status column (id,image_filename,latitude,longitude,location,description,status)
        reportFound = true;
        return row.join(",");
      }
      return line;
    });
    if (!reportFound) {
      return res.status(404).json({ message: "Report not found." });
    }
    // Write the updated CSV back to disk
    fs.writeFileSync(CSV_FILE, updatedLines.join("\n") + "\n");

    // Return the updated report as JSON
    const updatedReport = updatedLines.find((line) =>
      line.startsWith(reportId + ",")
    );
    const row = updatedReport.split(",");
    res.json({
      id: Number(row[0]),
      image_filename: row[1],
      latitude: Number(row[2]),
      longitude: Number(row[3]),
      location: row[4],
      description: row[5],
      status: row[6],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update report status." });
  }
});

// -----------------------------------------------------------------------------
// Endpoint: POST /signup
// User signup (stores users in memory)
app.post("/signup", (req, res) => {
  try {
    const { mobile_number, name, email, password, mpin } = req.body;
    // Check if user already exists by mobile number
    if (users.find((user) => user.mobile_number === mobile_number)) {
      return res.status(400).json({ message: "Mobile number already exists." });
    }
    const hashedPassword = hashPassword(password);
    const newUser = {
      mobile_number,
      name,
      email,
      password_hash: hashedPassword,
      mpin,
      wallet_amount: 0.0,
    };
    users.push(newUser);
    res.json({ message: "User created successfully", user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to sign up user." });
  }
});

// -----------------------------------------------------------------------------
// Endpoint: POST /login
// User login (checks in-memory users)
app.post("/login", (req, res) => {
  try {
    const { mobile_number, mpin } = req.body;
    const user = users.find((u) => u.mobile_number === mobile_number);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (user.mpin !== mpin) {
      return res.status(401).json({ message: "Invalid MPIN." });
    }
    // Return dummy contacts (all other users)
    const contacts = users
      .filter((u) => u.mobile_number !== mobile_number)
      .map((u) => ({
        mobile_number: u.mobile_number,
        name: u.name,
      }));
    res.json({
      message: "Login successful",
      user: { mobile_number: user.mobile_number, name: user.name },
      contacts: contacts,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to login user." });
  }
});

// Serve uploaded images statically
app.use(
  "/uploaded_images",
  express.static(path.join(__dirname, "uploaded_images"))
);

// -----------------------------------------------------------------------------
// Start the Express server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
