const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();
const app = express();

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://techalaxy1:htGI29CQApk3enDq@clusterlunaai.rdxe7vj.mongodb.net/?retryWrites=true&w=majority&appName=ClusterLunaAI', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String
});

const messageSchema = new mongoose.Schema({
  user_id: mongoose.Schema.Types.ObjectId,
  role: String,
  message: String,
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('attached_assets'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'lunasecret',
  resave: false,
  saveUninitialized: true
}));

// Routes
app.get('/messages', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const history = await Message.find({ user_id: req.session.userId }).sort({ created_at: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching messages' });
  }
});
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

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Registration
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    const user = await User.create({ name, email, password: hashed });
    req.session.userId = user._id;
    res.redirect('/');
  } catch (err) {
    res.send("Email already exists. <a href='/register'>Try again</a>");
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.sendFile(path.join(__dirname, 'views', 'account-not-found.html'));

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.sendFile(path.join(__dirname, 'views', 'account-not-found.html'));

  req.session.userId = user._id;
  res.redirect('/');
});

// Admin login
app.get('/admin', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(__dirname, 'views', 'admin-login.html'));
});

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
app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.isAdmin) return res.redirect('/admin');

  try {
    const users = await User.find().sort({ _id: -1 });
    const messages = await Message.find().sort({ created_at: -1 }).limit(10);

    const userRows = users.map(u => `<tr><td>${u._id}</td><td>${u.name}</td><td>${u.email}</td></tr>`).join("");
    const messageRows = messages.map(m => `<tr><td>${m.user_id}</td><td>${m.role}</td><td>${m.message}</td><td>${m.created_at}</td></tr>`).join("");

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
  } catch (err) {
    res.send("Error loading admin dashboard.");
  }
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
      throw new Error("OpenRouter API key not found");
    }

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
          "X-Title": "Luna AI",
          "Content-Type": "application/json"
        }
      }
    );

    const aiResponse = openRouterRes.data.choices[0].message.content;

    // Save message to DB
    await Message.create({
      user_id: userId,
      role: 'user',
      message: userMsg
    });

    await Message.create({
      user_id: userId,
      role: 'assistant',
      message: aiResponse
    });

    res.json({ response: aiResponse });
  } catch (err) {
    console.error("AI error:", err.message);
    res.status(500).json({ response: "Error processing your request. Please try again later." });
  }
});

// Show profile page
app.get('/profile', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'views', 'profile.html'));
});

// Send user data to frontend
app.get('/profile-data', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await User.findById(req.session.userId);
  res.json({ name: user.name, email: user.email });
});

// Handle password update
app.post('/update-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const hashed = await bcrypt.hash(req.body.password, 10);

  await User.findByIdAndUpdate(req.session.userId, { password: hashed });
  res.redirect('/profile');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Luna AI running on port ${PORT}`);
});
