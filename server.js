const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const db = new sqlite3.Database('./database/luna.sqlite');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lunasecret',
  resave: false,
  saveUninitialized: true
}));

// Initialize tables
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

// Routes
app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
app.post('/chat', async (req, res) => {
  const userId = req.session.userId;
  const userMsg = req.body.message;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  try {
    const openaiRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: userMsg }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("OpenAI response:", openaiRes.data);
    const aiResponse = openaiRes.data.choices?.[0]?.message?.content || "No reply from AI.";
    res.json({ response: aiResponse });

  } catch (err) {
    console.error("OpenAI error:", err.response?.data || err.message);
    res.status(500).json({ response: "Error contacting OpenAI" });
  }
});


// Register logic
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  db.run(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`, [name, email, hashed], function(err) {
    if (err) return res.send("Email already exists. <a href='/register'>Try again</a>");
    req.session.userId = this.lastID;
    res.redirect('/');
  });
});

// Login logic
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) return res.send("No account found. <a href='/login'>Try again</a>");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Wrong password. <a href='/login'>Try again</a>");

    req.session.userId = user.id;
    res.redirect('/');
  });
});

// Logout logic
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Luna AI running on port ${PORT}`));

const axios = require('axios');

app.post('/chat', async (req, res) => {
  const userId = req.session.userId;
  const userMsg = req.body.message;

  if (!userId) return res.status(401).json({ error: "Not logged in" });

  try {
    const openaiRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: userMsg }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("OpenAI response:", openaiRes.data);
    const aiResponse = openaiRes.data.choices?.[0]?.message?.content || "No reply from AI.";


    // Optional: save to database here
    res.json({ response: aiResponse });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ response: "Error contacting OpenAI" });
  }
});
