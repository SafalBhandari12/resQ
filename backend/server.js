const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const port = 8080;

// Base URL for the Python prediction backend
const PREDICTION_URL = "https://ea44-34-19-21-62.ngrok-free.app/predict";

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

// CSV file to store reports with updated columns
const CSV_FILE = "reports.csv";

// Create CSV file with headers if it does not exist
if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(
    CSV_FILE,
    "id,image_filename,latitude,longitude,location,description,severity,humanitarian,disaster_or_not,urgency_level\n"
  );
}

// In-memory users array for signup/login
const users = [];

// Utility function to hash a password
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Determine urgency level by comparing the prediction values exactly
function getUrgencyLevel(humanitarian, severity) {
  if (humanitarian === "affected_injured_or_dead_people") {
    if (severity === "severe") return "5 (Critical)";
    else if (severity === "mild") return "4 (High)";
    else if (severity === "little_or_none") return "3 (Moderate)";
  } else if (humanitarian === "infrastructure_and_utility_damage") {
    if (severity === "severe") return "4 (High)";
    else if (severity === "mild") return "3 (Moderate)";
    else if (severity === "little_or_none") return "2 (Low)";
  } else if (humanitarian === "rescue_volunteering_or_donation_effort") {
    if (severity === "severe") return "3 (Moderate)";
    else if (severity === "mild") return "2 (Low)";
    else if (severity === "little_or_none") return "1 (Minimal)";
  } else if (humanitarian === "not_humanitarian") {
    if (severity === "severe") return "2 (Low)";
    else if (severity === "mild" || severity === "little_or_none")
      return "1 (Minimal)";
  }
  return "N/A"; // Return "N/A" if no condition is met
}

// -----------------------------------------------------------------------------
// Endpoint: POST /user/report/
// Upload a report, predict damage severity, humanitarian impact, and disaster text,
// then store the report with predictions and urgency level in the CSV.
app.post("/user/report/", upload.single("image"), async (req, res) => {
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

    // Call prediction endpoints from the Python backend

    // 1. Damage severity prediction (expects image file with "model" = "damage")
    const damageForm = new FormData();
    damageForm.append("model", "damage");
    damageForm.append("file", fs.createReadStream(image.path));

    const damageResponse = await axios.post(PREDICTION_URL, damageForm, {
      headers: damageForm.getHeaders(),
    });
    const severityPrediction = damageResponse.data.predicted_label;

    // 2. Humanitarian prediction (expects image file with "model" = "humanitarian")
    const humanForm = new FormData();
    humanForm.append("model", "humanitarian");
    humanForm.append("file", fs.createReadStream(image.path));

    const humanResponse = await axios.post(PREDICTION_URL, humanForm, {
      headers: humanForm.getHeaders(),
    });
    const humanitarianPrediction = humanResponse.data.predicted_label;

    // 3. Disaster prediction (text based using description; expects "model" = "text")
    const textForm = new FormData();
    textForm.append("model", "text");
    textForm.append("data", description);

    const textResponse = await axios.post(PREDICTION_URL, textForm, {
      headers: textForm.getHeaders(),
    });
    const disasterPrediction = textResponse.data.predicted_label;

    // Determine urgency level based on exact prediction values
    const urgencyLevel = getUrgencyLevel(
      humanitarianPrediction,
      severityPrediction
    );

    // Append new report data to the CSV file
    const newRow = `${reportId},${image.filename},${latitude},${longitude},${location},${description},${severityPrediction},${humanitarianPrediction},${disasterPrediction},${urgencyLevel}\n`;
    fs.appendFileSync(CSV_FILE, newRow);

    // Return the report details along with predictions and urgency level
    res.json({
      id: reportId,
      image_filename: image.filename,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      location,
      description,
      severity: severityPrediction,
      humanitarian: humanitarianPrediction,
      disaster_or_not: disasterPrediction,
      urgency_level: urgencyLevel,
    });
  } catch (error) {
    console.error("Error in report upload:", error.message);
    res.status(500).json({ message: "Failed to upload report." });
  }
});

// -----------------------------------------------------------------------------
// Endpoint: GET /user/reports/
// Fetch all reports from the CSV file (with updated columns)
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
    console.error("Error fetching reports:", error.message);
    res.status(500).json({ message: "Failed to fetch reports." });
  }
});

// -----------------------------------------------------------------------------
// Endpoint: POST /signup
// User signup (stores users in memory)
app.post("/signup", (req, res) => {
  try {
    const { mobile_number, name, email, password, mpin } = req.body;
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
    console.error("Error in signup:", error.message);
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
    console.error("Error in login:", error.message);
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