const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

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
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
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

// Chat endpoint
app.post('/chat', async (req, res) => {
  const userId = req.session.userId;
  const userMsg = req.body.message;

  if (!userId) {
    return res.status(401).json({ response: "Please log in first. Click the login link below to continue.", error: "Not logged in" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key not found in environment variables");
    }

    console.log("Sending message to OpenAI:", userMsg);
    
    console.log("Using API Key:", process.env.OPENAI_API_KEY ? "Key is present" : "Key is missing");
    
    // Add delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const openaiRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("OpenAI raw response:", openaiRes.data);
    
    if (!openaiRes.data?.choices?.[0]?.message?.content) {
      console.error("Unexpected API response format:", openaiRes.data);
      throw new Error("Unexpected response format from OpenAI");
    }

    const aiResponse = openaiRes.data.choices[0].message.content;
    console.log("Final AI response:", aiResponse);
    res.json({ response: aiResponse });

  } catch (err) {
    console.error("OpenAI error:", err.message);
    let errorMessage;
    if (err.response?.status === 429) {
      errorMessage = "Please wait a moment and try again - the AI is processing too many requests";
    } else {
      errorMessage = process.env.OPENAI_API_KEY 
        ? "Error contacting OpenAI. Please try again in a few moments."
        : "OpenAI API key not configured";
    }
    res.status(500).json({ response: errorMessage });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Luna AI running on port ${PORT}`));