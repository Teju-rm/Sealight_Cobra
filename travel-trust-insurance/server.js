const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const packageInfo = require('./package.json');
const { startCoverageAgent, enableCoverageAgent, takeCoverageSnapshot } = require('./coverage-agent.cjs');

const app = express();
const PORT = process.env.PORT || 3000;
// CI/CD should set BUILD_VERSION to the release number or commit SHA. The
// package version keeps local development recordings grouped consistently.
const BUILD_VERSION = process.env.BUILD_VERSION || packageInfo.version;
const COVERAGE_ENVIRONMENT = process.env.COVERAGE_ENVIRONMENT || process.env.DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || 'Development';
const coverageAgentReady = startCoverageAgent();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: 'traveltrust-demo-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Make session available in all EJS views
app.use(function assignCoverageViewLocals(req, res, next) {
  res.locals.session = req.session;
  res.locals.buildVersion = BUILD_VERSION;
  res.locals.coverageEnvironment = COVERAGE_ENVIRONMENT;
  next();
});

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.post('/__coverage__/snapshot', async function coverageSnapshotHandler(req, res) {
  if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') return res.status(404).json({ error: 'Coverage agent is local-only.' });
  try {
    await coverageAgentReady;
    return res.json(await takeCoverageSnapshot());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/__coverage__/start', async function coverageStartHandler(req, res) {
  if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') return res.status(404).json({ error: 'Coverage agent is local-only.' });
  try {
    await enableCoverageAgent();
    return res.json({ enabled: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Import routes
const quoteRoutes = require('./routes/quote');
const productsRoutes = require('./routes/products');
const contactRoutes = require('./routes/contact');
const claimRoutes = require('./routes/claim');
const adminRoutes = require('./routes/admin');

// API routes
app.use('/api/quote', quoteRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/claims', claimRoutes);

// Admin routes (with session-based auth — see routes/admin.js)
app.use('/admin', adminRoutes);

// ===== MY-CLAIMS ROUTE =====

// GET /my-claims — Show the claim selected by the user's name + policy number login
app.get('/my-claims', async (req, res) => {
  // Check if user is logged in with role 'user'
  if (!req.session || req.session.role !== 'user') {
    // If admin somehow lands here, redirect them to /admin/claims
    if (req.session && req.session.role === 'admin') {
      return res.redirect('/admin/claims');
    }
    return res.redirect('/login');
  }

  if (!req.session.claimRecordId) {
    return res.redirect('/login');
  }

  try {
    const { getDatabase } = require('./db/database');
    const db = await getDatabase();

    // Query only the exact claim matched during login
    const result = db.exec(
      'SELECT id, full_name, policy_number, email, phone, date_of_incident, claim_type, description, claim_id, created_at FROM claims WHERE id = ? LIMIT 1',
      [req.session.claimRecordId]
    );

    // Parse sql.js result into array of objects
    const claims = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      const values = result[0].values;
      for (const row of values) {
        const obj = {};
        columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        claims.push(obj);
      }
    }

    res.render('my-claims', {
      title: 'My Claims',
      navActive: '',
      claims
    });
  } catch (err) {
    console.error('Error fetching user claims:', err);
    res.status(500).send('Failed to load claims data.');
  }
});

// ===== AUTH ROUTES =====

function wantsJson(req) {
  return (req.get('accept') || '').includes('application/json');
}

function respondLoginError(req, res, status, renderData, error) {
  if (wantsJson(req)) {
    return res.status(status).json({ success: false, error });
  }

  return res.render('login', renderData);
}

// GET /login - Show login page with separate admin/user sections
app.get('/login', function loginPageHandler(req, res) {
  res.render('login', { adminError: null, userError: null });
});

// POST /login/admin - Process admin login
app.post('/login/admin', function adminLoginHandler(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return respondLoginError(
      req,
      res,
      401,
      { adminError: 'Invalid username or password', userError: null },
      'Invalid username or password'
    );
  }

  // Load users from data/users.json
  const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'users.json'), 'utf8'));
  const user = users.find(u => u.username === username && u.password === password && u.role === 'admin');

  if (!user) {
    return respondLoginError(
      req,
      res,
      401,
      { adminError: 'Invalid username or password', userError: null },
      'Invalid username or password'
    );
  }

  // Create session
  req.session.username = user.username;
  req.session.role = user.role;
  if (user.email) req.session.email = user.email;

  if (wantsJson(req)) {
    return res.json({ success: true, redirect: '/admin/claims' });
  }

  res.redirect('/admin/claims');
});

// POST /login/user - Process user login using claim name + policy number
app.post('/login/user', async function userLoginHandler(req, res) {
  const { full_name, policy_number } = req.body;

  if (!full_name || !policy_number) {
    return respondLoginError(
      req,
      res,
      400,
      { adminError: null, userError: 'Please enter your name and policy number' },
      'Please enter your name and policy number'
    );
  }

  try {
    const { getDatabase } = require('./db/database');
    const db = await getDatabase();

    // Check if a claim exists matching the name and policy number
    const result = db.exec(
      'SELECT id, full_name, email FROM claims WHERE lower(trim(full_name)) = lower(trim(?)) AND policy_number = ? ORDER BY created_at DESC LIMIT 1',
      [full_name, policy_number]
    );

    if (result.length === 0 || result[0].values.length === 0) {
      return respondLoginError(
        req,
        res,
        401,
        { adminError: null, userError: 'No claim found for that name and policy number' },
        'No claim found for that name and policy number'
      );
    }

    // Create session
    const columns = result[0].columns;
    const values = result[0].values[0];
    const claim = {};
    columns.forEach((col, idx) => {
      claim[col] = values[idx];
    });

    req.session.claimRecordId = claim.id;
    req.session.email = claim.email;
    req.session.role = 'user';
    req.session.username = claim.full_name;

    if (wantsJson(req)) {
      return res.json({ success: true, redirect: '/my-claims' });
    }

    res.redirect('/my-claims');
  } catch (err) {
    console.error('Error validating user login:', err);
    respondLoginError(
      req,
      res,
      500,
      { adminError: null, userError: 'An error occurred. Please try again.' },
      'An error occurred. Please try again.'
    );
  }
});

// GET /logout - Destroy session and redirect to homepage
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/');
  });
});

// Helper: load products
function productsDataPath() {
  return path.join(__dirname, 'data', 'products.json');
}

function loadProducts() {
  try {
    const data = fs.readFileSync(productsDataPath(), 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading products:', error);
    return [];
  }
}

// ===== PAGE ROUTES =====

// HOME
app.get('/', (req, res) => {
  const allProducts = loadProducts();
  res.render('index', {
    products: allProducts,
    category: ''
  });
});

// PRODUCTS LIST
app.get('/products', (req, res) => {
  const allProducts = loadProducts();
  res.render('products', { products: allProducts, category: '' });
});

// PRODUCT DETAIL
app.get('/products/:id', (req, res) => {
  const allProducts = loadProducts();
  const product = allProducts.find(p => p.id === req.params.id);
  if (!product) {
    return res.status(404).render('products', { products: [], category: '', error: 'Product not found' });
  }
  res.render('product-detail', { product });
});

// QUOTE PAGE
app.get('/quote', (req, res) => {
  const products = loadProducts();
  res.render('quote', { products });
});

// ABOUT PAGE
app.get('/about', (req, res) => {
  res.render('about');
});

// SUSTAINABILITY PAGE
app.get('/sustainability', (req, res) => {
  res.render('sustainability');
});

// TRANSPORTATION PAGE
app.get('/transportation', (req, res) => {
  res.render('transportation');
});

// CONTACT PAGE
app.get('/contact', (req, res) => {
  res.render('contact');
});

// CLAIM PAGE
app.get('/claim', (req, res) => {
  res.render('claim');
});

// CLAIM STATUS PAGE
app.get('/claim-status', (req, res) => {
  res.render('claim-status');
});

// CLAIM GUIDE LIBRARY PAGE
app.get('/claim-guide', (req, res) => {
  res.render('claim-guide');
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Start server
app.listen(PORT, () => {
  console.log(`TravelTrust Insurance app running at http://localhost:${PORT}`);
});

