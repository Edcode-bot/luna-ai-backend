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
app.use(express.static('attached_assets'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lunasecret',
  resave: false,
  saveUninitialized: true
}));

// Admin login page
app.get('/admin', (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, 'views', 'admin-login.html'));
});

// Handle admin login
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.isAdmin = true;
    return res.redirect('/admin/dashboard');
  }

  res.send("Invalid login. <a href='/admin'>Try again</a>");
});

// Admin dashboard
app.get('/admin/dashboard', (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin');

  db.all("SELECT id, name, email FROM users ORDER BY id DESC", (err, users) => {
    if (err) return res.send("Error loading users.");

    db.all("SELECT user_id, role, message, created_at FROM messages ORDER BY created_at DESC LIMIT 10", (err, messages) => {
      if (err) return res.send("Error loading messages.");

      let userRows = users.map(u => `<tr><td>${u.id}</td><td>${u.name}</td><td>${u.email}</td></tr>`).join("");
      let messageRows = messages.map(m => `<tr><td>${m.user_id}</td><td>${m.role}</td><td>${m.message}</td><td>${m.created_at}</td></tr>`).join("");

      res.send(`
        <html>
        <head>
          <title>Admin Dashboard</title>
          <style>
            body { font-family: sans-serif; padding: 2rem; background: #f8f9fa; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
            th, td { border: 1px solid #ddd; padding: 0.75rem; text-align: left; }
            th { background: #4f46e5; color: white; }
            a.logout { display: inline-block; margin-bottom: 1rem; color: #4f46e5; text-decoration: none; }
            a.logout:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>Admin Dashboard</h1>
          <a class="logout" href="/logout">Logout</a>

          <h2>Registered Users</h2>
          <table>
            <tr><th>ID</th><th>Name</th><th>Email</th></tr>
            ${userRows}
          </table>

          <h2>Recent Messages</h2>
          <table>
            <tr><th>User ID</th><th>Role</th><th>Message</th><th>Time</th></tr>
            ${messageRows}
          </table>
        </body>
        </html>
      `);
    });
  });
});

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
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
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

// Login logic with proper error page
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err || !user) {
      return res.sendFile(path.join(__dirname, 'views', 'account-not-found.html'));
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.sendFile(path.join(__dirname, 'views', 'account-not-found.html'));
    }

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
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("OpenRouter API key not found in environment variables");
    }

    console.log("Sending message to OpenRouter:", userMsg);
    console.log("Using API Key:", process.env.OPENROUTER_API_KEY ? "Key is present" : "Key is missing");

    await new Promise(resolve => setTimeout(resolve, 1000)); // Delay

    const openRouterRes = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 1000,
        temperature: 0.7
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://replit.com",
          "X-Title": "Educore AI",
          "Content-Type": "application/json"
        }
      }
    );

    const aiResponse = openRouterRes.data.choices[0].message.content;
    res.json({ response: aiResponse });

  } catch (err) {
    console.error("OpenRouter error:", err.message);
    let errorMessage;

    if (err.response?.status === 429) {
      errorMessage = "Please wait a moment and try again - the AI is processing too many requests";
    } else {
      errorMessage = "Something went wrong. Try again later.";
    }

    res.status(500).json({ response: errorMessage });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Luna AI running on port ${PORT}`);
});
